require("hardhat/config")
const { BigNumber } = require("@ethersproject/bignumber");
const helpers = require("../scripts/helpers");
const addresses = require("../lib/addresses");

const BN = n => BigNumber.from(n);
const ONE_TOKEN = decimals => BigNumber.from('10').pow(BigNumber.from(decimals));
const mainnetContracts = addresses.IdleTokens.mainnet;

/**
 * @name deploy
 * eg `npx hardhat deploy --cdoname idledai`
 */
task("deploy", "Deploy IdleCDO, IdleStrategy and Staking contract for rewards with default parameters")
  .addParam('cdoname')
  .setAction(async (args) => {
    // Run 'compile' task
    await run("compile");
    const deployToken = addresses.deployTokens[args.cdoname];

    const signer = await helpers.getSigner();
    const creator = await signer.getAddress();

    if (deployToken.cdo && deployToken.cdo.cdoAddr && hre.network == 'mainnet') {
      console.log(`CDO Already deployed here ${deployToken.cdo.cdoAddr}`);
      return;
    }
    await helpers.prompt("continue? [y/n]", true);

    const incentiveTokens = [mainnetContracts.IDLE];
    const strategy = await helpers.deployUpgradableContract('IdleStrategy', [deployToken.idleToken, creator], signer);
    const idleCDO = await helpers.deployUpgradableContract(
      'IdleCDO',
      [
        BN('500000').mul(ONE_TOKEN(deployToken.decimals)), // limit
        deployToken.underlying,
        mainnetContracts.treasuryMultisig, // recovery address
        creator, // guardian
        mainnetContracts.rebalancer,
        strategy.address,
        BN('20000'), // apr split: 20% interest to AA and 80% BB
        BN('50000'), // ideal value: 50% AA and 50% BB tranches
        incentiveTokens
      ],
      signer
    );
    await strategy.connect(signer).setWhitelistedCDO(idleCDO.address);
    const AAaddr = await idleCDO.AATranche();
    const BBaddr = await idleCDO.BBTranche();
    console.log(`AATranche: ${AAaddr}, BBTranche: ${BBaddr}`);

    const stakingCoolingPeriod = BN(1500);
    const stakingRewardsParams = [
      incentiveTokens,
      creator, // owner / guardian
      idleCDO.address,
      mainnetContracts.devLeagueMultisig, // recovery address
      stakingCoolingPeriod
    ];
    const stakingRewardsAA = await helpers.deployUpgradableContract(
      'IdleCDOTrancheRewards', [AAaddr, ...stakingRewardsParams], signer
    );
    const stakingRewardsBB = await helpers.deployUpgradableContract(
      'IdleCDOTrancheRewards', [BBaddr, ...stakingRewardsParams], signer
    );
    await idleCDO.connect(signer).setStakingRewards(stakingRewardsAA.address, stakingRewardsBB.address);
    console.log(`stakingRewardsAA: ${await idleCDO.AAStaking()}, stakingRewardsBB: ${await idleCDO.BBStaking()}`);
    console.log(`staking reward contract set`);
    console.log();
    return {idleCDO, strategy, AAaddr, BBaddr};
  });

/**
 * @name info
 */
task("info", "IdleCDO info")
  .addParam("cdo")
  .setAction(async (args) => {
    console.log(args.cdo);
    let idleCDO = await ethers.getContractAt("IdleCDO", args.cdo);
    console.log(`stakingRewardsAA: ${await idleCDO.AAStaking()}, stakingRewardsBB: ${await idleCDO.BBStaking()}`);
    console.log(`AATranche: ${await idleCDO.AATranche()}, BBTranche: ${await idleCDO.BBTranche()}`);
    console.log(`IdleStrategy: ${await idleCDO.strategy()}`);
  });

/**
 * @name upgrade-cdo
 */
task("upgrade-cdo", "Upgrade IdleCDO instance")
  .addParam('cdoname')
  .setAction(async (args) => {
    // Run 'compile' task
    await run("compile");
    const deployToken = addresses.deployTokens[args.cdoname];

    const contractAddress = deployToken.cdo.cdoAddr;
    if (!contractAddress) {
      console.log(`IdleCDO Must be deployed`);
      return;
    }
    await helpers.prompt("continue? [y/n]", true);
    const signer = await run('get-signer-or-fake');
    await helpers.upgradeContract(contractAddress, 'IdleCDO', signer);
    console.log(`IdleCDO upgraded`);
  });

/**
 * @name upgrade-strategy
 */
task("upgrade-strategy", "Upgrade IdleCDO strategy")
  .addParam('cdoname')
  .setAction(async (args) => {
    // Run 'compile' task
    await run("compile");
    const deployToken = addresses.deployTokens[args.cdoname];
    console.log('deployToken', deployToken)
    console.log('deployToken.cdo', deployToken.cdo)
    const contractAddress = deployToken.cdo.strategy;
    if (!contractAddress) {
      console.log(`IdleCDO strategy Must be deployed`);
      return;
    }
    console.log(contractAddress);

    await helpers.prompt("continue? [y/n]", true);
    const signer = await run('get-signer-or-fake');
    await helpers.upgradeContract(contractAddress, 'IdleStrategy', signer);
    console.log(`IdleStrategy upgraded`);
  });

/**
 * @name transfer-ownership-cdo
 */
task("transfer-ownership-cdo", "Transfer IdleCDO ownership")
  .addParam('cdoname')
  .setAction(async (args) => {
    // Run 'compile' task
    await run("compile");

    // #### Change this if needed (avoid passing it via cli)
    const to = addresses.IdleTokens.mainnet.devLeagueMultisig;
    // ####

    console.log('NEW OWNER: ', to);
    const deployToken = addresses.deployTokens[args.cdoname];
    console.log('deployToken', deployToken)
    const proxyAdminAddress = deployToken.cdo.proxyAdmin;
    const contractAddress = deployToken.cdo.cdoAddr;
    const strategyAddress = deployToken.cdo.strategy;
    if (!contractAddress || !strategyAddress || !proxyAdminAddress || !to) {
      console.log(`IdleCDOAddress, to, strategyAddress and proxyAdminAddress Must be defined`);
      return;
    }
    await helpers.prompt("continue? [y/n]", true);
    const signer = await run('get-signer-or-fake');

    const AARewardsAddress = deployToken.cdo.AArewards;
    if (AARewardsAddress) {
      console.log('Transfer ownership of AARewards');
      let AARewards = await ethers.getContractAt("IdleCDOTrancheRewards", AARewardsAddress);
      await AARewards.connect(signer).transferOwnership(to);
      console.log('New Owner', await AARewards.owner());
    }

    const BBRewardsAddress = deployToken.cdo.BBrewards;
    if (BBRewardsAddress) {
      console.log('Transfer ownership of BBRewards');
      let BBRewards = await ethers.getContractAt("IdleCDOTrancheRewards", BBRewardsAddress);
      await BBRewards.connect(signer).transferOwnership(to);
      console.log('New Owner', await BBRewards.owner());
    }

    console.log('Transfer ownership of IdleCDOStrategy');
    let strategy = await ethers.getContractAt("IdleStrategy", strategyAddress);
    await strategy.connect(signer).transferOwnership(to);
    console.log('New Owner', await strategy.owner());

    console.log('Transfer ownership of IdleCDO');
    let cdo = await ethers.getContractAt("IdleCDO", contractAddress);
    await cdo.connect(signer).transferOwnership(to);

    console.log('Transfer owner of proxyAdmin for all');
    let admin = await ethers.getContractAt("IProxyAdmin", proxyAdminAddress);
    await admin.connect(signer).transferOwnership(to);

    console.log('New Owner', await admin.owner());
  });

/**
 * @name pause-cdo-multisig
 */
task("pause-cdo-multisig", "Upgrade IdleCDO instance")
  .addParam('cdoname')
  .setAction(async (args) => {
    const deployToken = addresses.deployTokens[args.cdoname];
    console.log('deployToken', deployToken)
    let cdo = await ethers.getContractAt("IdleCDO", deployToken.cdo.cdoAddr);
    const multisig = await run('get-multisig-or-fake');
    await cdo.connect(multisig).pause();
    console.log('Is Paused ? ', await cdo.paused());
  });

/**
 * @name emergency-shutdown-cdo-multisig
 */
task("emergency-shutdown-cdo-multisig", "Upgrade IdleCDO instance")
  .addParam('cdoname')
  .setAction(async (args) => {
    const deployToken = addresses.deployTokens[args.cdoname];
    console.log('deployToken', deployToken)
    let cdo = await ethers.getContractAt("IdleCDO", deployToken.cdo.cdoAddr);
    const multisig = await run('get-multisig-or-fake');
    await cdo.connect(multisig).emergencyShutdown();
    console.log('Is Paused ? ', await cdo.paused());
    console.log('Allow AA withdraw ? ', await cdo.allowAAWithdraw());
    console.log('Allow BB withdraw ? ', await cdo.allowBBWithdraw());
  });

/**
 * @name get-signer-or-fake
 */
subtask("get-signer-or-fake", "Get signer")
  .setAction(async (args) => {
    let signer;
    if (hre.network.name !== 'mainnet') {
      signer = await helpers.impersonateSigner(args.fakeAddress || addresses.idleDeployer);
    } else {
      signer = await helpers.getSigner();
    }
    console.log('Using signer with address: ', await signer.getAddress());
    return signer;
  });

/**
 * @name get-multisig-or-fake
 */
subtask("get-multisig-or-fake", "Get multisig signer")
  .setAction(async (args) => {
    let signer;
    if (hre.network.name !== 'mainnet') {
      signer = await helpers.impersonateSigner(args.fakeAddress || addresses.IdleTokens.mainnet.devLeagueMultisig);
    } else {
      signer = await helpers.getMultisigSigner();
    }
    console.log('Using signer with address: ', await signer.getAddress());
    return signer;
  });
