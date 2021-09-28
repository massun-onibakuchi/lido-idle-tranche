require("hardhat/config");
const { BigNumber } = require("@ethersproject/bignumber");
const helpers = require("../scripts/helpers");
const erc20 = require("../artifacts/contracts/interfaces/IERC20Detailed.sol/IERC20Detailed.json");
const addresses = require("../lib/addresses");
const { expect } = require("chai");
const { FakeContract, smock } = require("@defi-wonderland/smock");

require("chai").use(smock.matchers);

const BN = (n) => BigNumber.from(n.toString());
const ONE_TOKEN = (n, decimals) => BigNumber.from("10").pow(BigNumber.from(n));
const MAX_UINT = BN(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935"
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("IdleLidoStrategy", function () {
  beforeEach(async () => {
    // deploy contracts
    signers = await ethers.getSigners();
    owner = signers[0];
    AABuyer = signers[1];
    AABuyerAddr = AABuyer.address;
    BBBuyer = signers[2];
    BBBuyerAddr = BBBuyer.address;
    AABuyer2 = signers[3];
    AABuyer2Addr = AABuyer2.address;
    BBBuyer2 = signers[4];
    BBBuyer2Addr = BBBuyer2.address;
    Random = signers[5];
    RandomAddr = Random.address;
    Random2 = signers[6];
    Random2Addr = Random2.address;
    Fund = signers[7];

    one = ONE_TOKEN(18);
    slipageBps = 100;

    const MockWETH = await ethers.getContractFactory("MockWETH");
    const MockLido = await ethers.getContractFactory("MockLido");
    const MockLidoOracle = await ethers.getContractFactory("MockLidoOracle");
    const PriceFeed = await ethers.getContractFactory("MockStETHPriceFeed");
    const StableSwap = await ethers.getContractFactory("MockStableSwapSTETH");

    underlying = await MockWETH.deploy({
      value: BN("100").mul(ONE_TOKEN(18)),
    });
    await underlying.deployed();

    lido = await MockLido.deploy();
    await lido.deployed();

    oracle = await MockLidoOracle.deploy();
    await oracle.deployed();

    priceFeed = await PriceFeed.deploy();
    await priceFeed.deployed();

    stableSwap = await StableSwap.deploy();
    await stableSwap.deployed();

    // Params
    initialAmount = BN("10").mul(ONE_TOKEN(18));

    strategy = await helpers.deployUpgradableContract(
      "IdleLidoStrategy",
      [
        lido.address,
        underlying.address,
        priceFeed.address,
        stableSwap.address,
        owner.address,
        ZERO_ADDRESS,
        slipageBps,
      ],
      owner
    );

    // Fund wallets
    await helpers.fundWallets(
      underlying.address,
      [
        AABuyerAddr,
        BBBuyerAddr,
        AABuyer2Addr,
        BBBuyer2Addr,
        stableSwap.address,
      ],
      owner.address,
      initialAmount
    );
    await lido
      .connect(Fund)
      .submit(ZERO_ADDRESS, { value: BN("10").mul(ONE_TOKEN(18)) });

    Fund.sendTransaction({
      to: stableSwap.address,
      value: BN("10").mul(ONE_TOKEN(18)),
    });

    // set mocks
    await stableSwap.setCoins([
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      lido.address,
    ]);
    await lido.setOracle(oracle.address);
  });

  it("should not reinitialize the contract", async () => {
    await expect(
      strategy
        .connect(owner)
        .initialize(
          lido.address,
          underlying.address,
          priceFeed.address,
          stableSwap.address,
          owner.address,
          ZERO_ADDRESS,
          slipageBps
        )
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("should initialize", async () => {
    expect(await strategy.strategyToken()).to.equal(lido.address);
    expect(await strategy.token()).to.equal(underlying.address);
    expect(await strategy.oneToken()).to.be.equal(one);
    expect(await strategy.tokenDecimals()).to.be.equal(BN(18));
    expect(await strategy.underlyingToken()).to.be.equal(underlying.address);
    expect(await strategy.lido()).to.equal(lido.address);
    expect(await strategy.stableSwap()).to.equal(stableSwap.address);
    expect(await strategy.priceFeed()).to.equal(priceFeed.address);
    expect(await strategy.referral()).to.equal(ZERO_ADDRESS);
    expect(await strategy.slipageBps()).to.equal(slipageBps);

    expect(
      await underlying.allowance(strategy.address, lido.address)
    ).to.be.equal(0);
    expect(await strategy.owner()).to.equal(owner.address);
  });

  it("should deposit", async () => {
    const addr = AABuyerAddr;
    const _amount = BN("1").mul(one);
    const _outputStEth = await calcOuputStEth(_amount);

    const initialStEthBal = await lido.balanceOf(addr);

    await deposit(addr, _amount);
    const finalBal = await underlying.balanceOf(addr);
    const finalStEthBal = await lido.balanceOf(addr);

    expect(initialAmount.sub(finalBal)).to.equal(_amount);
    expect(finalStEthBal.sub(initialStEthBal)).to.equal(_outputStEth);

    // No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await lido.balanceOf(strategy.address)).to.equal(0);
  });

  const calcOuputStEth = async (deposit) => {
    const total = await lido.getTotalPooledEther();
    const totalSupply = await lido.totalSupply();
    if (total.eq(BN(0))) return deposit;
    else return deposit.mul(totalSupply).div(total);
  };

  it("should redeem", async () => {
    const addr = AABuyerAddr;
    const _amount = BN("1").mul(one);
    const _outputStEth = await calcOuputStEth(_amount);

    await deposit(addr, _amount);

    const initialStEthBal = await lido.balanceOf(addr);
    const initialBal = await underlying.balanceOf(addr);

    await priceFeed.setPrice(one);
    await redeem(addr, _outputStEth);

    const finalStEthBal = await lido.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);

    expect(finalStEthBal).to.equal(0);
    expect(finalBal.sub(initialBal)).to.equal(_amount);

    // No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await lido.balanceOf(strategy.address)).to.equal(0);
  });

  it("should skip redeem if amount is 0", async () => {
    const addr = AABuyerAddr;
    const _amount = BN("1").mul(one);

    await deposit(addr, _amount);

    const initialBal = await underlying.balanceOf(addr);
    const initialStEthBal = await lido.balanceOf(addr);

    await priceFeed.setPrice(one);
    await redeem(addr, BN("0"));

    const finalStEthBal = await lido.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);

    expect(finalStEthBal).to.equal(initialStEthBal);
    expect(finalBal).to.equal(initialBal);

    // No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await lido.balanceOf(strategy.address)).to.equal(0);
  });
  it("should redeemUnderlying", async () => {
    const addr = AABuyerAddr;
    const _amount = BN("1").mul(one);

    await deposit(addr, _amount);

    const initialStEthBal = await lido.balanceOf(addr);
    const initialBal = await underlying.balanceOf(addr);

    await priceFeed.setPrice(one);
    await redeemUnderlying(addr, _amount);

    const finalStEthBal = await lido.balanceOf(addr);
    const finalBal = await underlying.balanceOf(addr);

    expect(finalStEthBal).to.equal(0);
    expect(finalBal.sub(initialBal)).to.equal(_amount);

    // No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await lido.balanceOf(strategy.address)).to.equal(0);
  });
  it("should skip redeemRewards if bal is 0", async () => {
    const addr = RandomAddr;
    await strategy.connect(Random).redeemRewards();

    // No token left in the contract
    expect(await underlying.balanceOf(strategy.address)).to.equal(0);
    expect(await lido.balanceOf(strategy.address)).to.equal(0);
  });
  it("setWhitelistedCDO should set the relative address and be called only by the owner", async () => {
    const val = RandomAddr;
    await strategy.setWhitelistedCDO(val);
    expect(await strategy.whitelistedCDO()).to.be.equal(val);

    await expect(
      strategy.setWhitelistedCDO(addresses.addr0)
    ).to.be.revertedWith("IS_0");

    await expect(
      strategy.connect(BBBuyer).setWhitelistedCDO(val)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should return the current price", async () => {
    const _amount = BN("1").mul(one);
    await priceFeed.setPrice(_amount);
    expect(await strategy.price()).to.equal(_amount);
  });

  it("should return the current net apr", async () => {
    const _amount = BN("10").mul(one);
    const postTotalPooledEther = BN("1314070").mul(one);
    const preTotalPooledEther = BN("1313868").mul(one);
    const timeElapsed = BN("86400");

    // set lido mocked params
    await oracle.setLastCompletedEpochDelta(
      postTotalPooledEther,
      preTotalPooledEther,
      timeElapsed
    );

    expect(await strategy.getApr()).to.equal(
      calcApr(
        postTotalPooledEther,
        preTotalPooledEther,
        timeElapsed,
        BN("1000")
      )
    );
  });

  const calcApr = (
    postTotalPooledEther,
    preTotalPooledEther,
    timeElapsed,
    feeBps
  ) => {
    const secondsInYear = BN((365 * 24 * 3600).toString());
    const apr = postTotalPooledEther
      .sub(preTotalPooledEther)
      .mul(secondsInYear)
      .mul(one)
      .mul("100")
      .div(preTotalPooledEther.mul(timeElapsed));
    return apr.sub(apr.mul(feeBps).div(BN("10000")));
  };

  const deposit = async (addr, amount) => {
    await helpers.sudoCall(addr, underlying, "approve", [
      strategy.address,
      MAX_UINT,
    ]);
    await helpers.sudoCall(addr, strategy, "deposit", [amount]);
  };
  const redeem = async (addr, amount) => {
    await helpers.sudoCall(addr, lido, "approve", [strategy.address, MAX_UINT]);
    await helpers.sudoCall(addr, strategy, "redeem", [amount]);
  };
  const redeemUnderlying = async (addr, amount) => {
    await helpers.sudoCall(addr, lido, "approve", [strategy.address, MAX_UINT]);
    await helpers.sudoCall(addr, strategy, "redeemUnderlying", [amount]);
  };
  const redeemRewards = async (addr, amount) => {
    await helpers.sudoCall(addr, lido, "approve", [strategy.address, MAX_UINT]);
    const [a, b, res] = await helpers.sudoCall(
      addr,
      strategy,
      "redeemRewards",
      []
    );
    return res;
  };
  const staticRedeemRewards = async (addr, amount) => {
    await helpers.sudoCall(addr, lido, "approve", [strategy.address, MAX_UINT]);
    return await helpers.sudoStaticCall(addr, strategy, "redeemRewards", []);
  };
});
