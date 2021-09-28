// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.7;

import "./interfaces/IIdleCDOStrategy.sol";
import "./interfaces/IERC20Detailed.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IStableSwapSTETH.sol";
import "./interfaces/IStETHPriceFeed.sol";
import "./interfaces/ILidoOracle.sol";
import "./interfaces/ILido.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "hardhat/console.sol";

/// @author Idle Labs Inc.
/// @title IdleLidoStrategy
/// @notice IIdleCDOStrategy to deploy funds in Idle Finance
/// @dev This contract should not have any funds at the end of each tx.
/// The contract is upgradable, to add storage slots, add them after the last `###### End of storage VXX`
contract IdleLidoStrategy is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IIdleCDOStrategy
{
    using SafeERC20Upgradeable for IERC20Detailed;
    using SafeERC20Upgradeable for ILido;

    /// ###### Storage V1
    /// @notice one stETH (It have 18 decimals)
    uint256 public constant ONE_STETH_TOKEN = 10**18;
    /// @notice seconds in year
    uint256 private constant SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
    /// @notice address of the strategy used, in this case Lido StETH
    address public override strategyToken;
    /// @notice underlying token address (WETH)
    address public override token;
    /// @notice one underlying token
    uint256 public override oneToken;
    /// @notice decimals of the underlying asset
    uint256 public override tokenDecimals;
    /// @notice underlying ERC20 token contract
    IERC20Detailed public underlyingToken;
    /// @notice lido contract
    ILido public lido;
    /// @notice Curve Fi StableSwap STETH/ETH
    IStableSwapSTETH public stableSwap;
    /// @notice Lido stETH/ETH price feed
    IStETHPriceFeed public priceFeed;

    /// @notice referral Lido
    address public referral;
    /// @notice stETH=>ETH
    uint256 public slipageBps;

    address public whitelistedCDO;

    /// ###### End of storage V1

    // Used to prevent initialization of the implementation contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        token = address(1);
    }

    // ###################
    // Initializer
    // ###################

    /// @notice can only be called once
    /// @dev Initialize the upgradable contract
    /// @param _strategyToken address of the strategy token
    /// @param _wethToken address of WETH
    /// @param _owner owner address
    function initialize(
        address _strategyToken,
        address _wethToken,
        address _priceFeed,
        address _stableSwap,
        address _owner,
        address _referral,
        uint256 _slipageBps
    ) public initializer {
        require(token == address(0), "Initialized");
        // Initialize contracts
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        // Set basic parameters
        strategyToken = _strategyToken;
        token = _wethToken;
        lido = ILido(_strategyToken);
        priceFeed = IStETHPriceFeed(_priceFeed);
        stableSwap = IStableSwapSTETH(_stableSwap);
        referral = _referral;
        slipageBps = _slipageBps;

        tokenDecimals = IERC20Detailed(token).decimals();
        oneToken = 10**(tokenDecimals);
        underlyingToken = IERC20Detailed(token);

        // transfer ownership
        transferOwnership(_owner);
    }

    // ###################
    // Public methods
    // ###################

    /// @dev msg.sender should approve this contract first to spend `_amount` of `token`
    /// @param _amount amount of `token` to deposit
    /// @return minted strategyTokens minted
    function deposit(uint256 _amount)
        external
        override
        returns (uint256 minted)
    {
        if (_amount > 0) {
            ILido _lido = lido;
            /// get `tokens` from msg.sender
            underlyingToken.safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
            IWETH(token).withdraw(_amount);
            /// deposit those in lido
            minted = _lido.submit{value: _amount}(referral);
            /// transfer stETH to msg.sender
            _lido.safeTransfer(msg.sender, minted);
        }
    }

    /// @dev msg.sender should approve this contract first to spend `_amount` of `strategyToken`
    /// @param _amount amount of strategyTokens to redeem
    /// @return amount of underlyings redeemed
    function redeem(uint256 _amount) external override returns (uint256) {
        return _redeem(_amount);
    }

    /// @notice Anyone can call this because this contract holds no stETH and so no 'old' rewards
    /// NOTE: stkAAVE rewards are not sent back to the use but accumulated in this contract until 'pullStkAAVE' is called
    /// @dev msg.sender should approve this contract first to spend `_amount` of `strategyToken`.
    /// redeem rewards and transfer them to msg.sender
    function redeemRewards()
        external
        override
        returns (uint256[] memory _balances)
    {}

    /// @dev msg.sender should approve this contract first
    /// to spend `_amount * ONE_STETH_TOKEN / price()` of `strategyToken`
    /// @param _amount amount of underlying tokens to redeem
    /// @return amount of underlyings redeemed
    function redeemUnderlying(uint256 _amount)
        external
        override
        returns (uint256)
    {
        // we are getting price before transferring so price of msg.sender
        return _redeem((_amount * ONE_STETH_TOKEN) / price());
    }

    // ###################
    // Internal
    // ###################

    /// @notice sends all gov tokens in this contract to an address
    /// NOTE: stkAAVE rewards are not sent back to the use but accumulated in this contract until 'pullStkAAVE' is called
    /// @dev only called
    /// @param _to address where to send gov tokens (rewards)
    function _withdrawGovToken(address _to)
        internal
        returns (uint256[] memory _balances)
    {}

    /// @dev msg.sender should approve this contract first to spend `_amount` of `strategyToken`
    /// @param _amount amount of strategyTokens to redeem
    /// @return redeemed amount of underlyings redeemed
    function _redeem(uint256 _amount) internal returns (uint256 redeemed) {
        if (_amount > 0) {
            ILido _lido = lido;
            // get stETH from the user
            _lido.safeTransferFrom(msg.sender, address(this), _amount);
            // swap stETH for ETH
            _lido.safeApprove(address(stableSwap), _amount);
            _swapStETHForETH(_amount, slipageBps);
            // wrap ETH
            redeemed = address(this).balance;
            IWETH(token).deposit{value: redeemed}();
            // transfer WETH to msg.sender
            underlyingToken.safeTransfer(msg.sender, redeemed);
            // transfer gov tokens to msg.sender
            _withdrawGovToken(msg.sender);
        }
    }

    /// @dev Swap stETH for ETH on the specified Curve stETH/ETH pool
    /// @param _amountStETH input amount of stETH 
    /// @param _slipageBps slipage tollerance
    /// @return amountOutETH 
    function _swapStETHForETH(uint256 _amountStETH, uint256 _slipageBps)
        internal
        returns (uint256 amountOutETH)
    {
        //1 bp = 0.01 %
        uint256 minETH = _amountStETH - (_amountStETH * _slipageBps) / 10000;
        // swap stETH for ETH using Curve stETH/ETH stableSwap.
        amountOutETH = stableSwap.exchange(1, 0, _amountStETH, minETH);
    }

    // ###################
    // Views
    // ###################

    /// @return net price in underlyings of 1 strategyToken
    function price() public view override returns (uint256) {
        (uint256 price_, ) = priceFeed.safe_price();
        return price_;
    }

    /// @dev Lido stETH: calculation of staker rewards  https://docs.lido.fi/contracts/lido-oracle#add-calculation-of-staker-rewards-apr
    /// @return apr net apr (fees should already be excluded)
    function getApr() external view override returns (uint256 apr) {
        ILidoOracle _lidoOralce = ILidoOracle(lido.getOracle());
        (
            uint256 postTotalPooledEther,
            uint256 preTotalPooledEther,
            uint256 timeElapsed
        ) = _lidoOralce.getLastCompletedReportDelta();

        if (postTotalPooledEther > preTotalPooledEther) {
            // Calculate APR
            apr =
                (((postTotalPooledEther - preTotalPooledEther) *
                    SECONDS_IN_YEAR) *
                    1e18 *
                    100) /
                (preTotalPooledEther * timeElapsed);
            // remove fee
            // Fee in basis points.  10000 BP corresponding to 100%.
            apr -= (apr * lido.getFee()) / 10000;
        }
    }

    /// @return tokens array of reward token addresses
    function getRewardTokens()
        external
        view
        override
        returns (address[] memory tokens)
    {}

    // ###################
    // Protected
    // ###################

    /// @notice Allow the CDO to pull stkAAVE rewards
    /// @return _bal amount of stkAAVE transferred
    function pullStkAAVE() external override returns (uint256 _bal) {}

    /// @notice This contract should not have funds at the end of each tx (except for stkAAVE), this method is just for leftovers
    /// @dev Emergency method
    /// @param _token address of the token to transfer
    /// @param value amount of `_token` to transfer
    /// @param _to receiver address
    function transferToken(
        address _token,
        uint256 value,
        address _to
    ) external onlyOwner nonReentrant {
        IERC20Detailed(_token).safeTransfer(_to, value);
    }

    /// @notice allow to update address whitelisted to pull stkAAVE rewards
    function setWhitelistedCDO(address _cdo) external onlyOwner {
        require(_cdo != address(0), "IS_0");
        whitelistedCDO = _cdo;
    }

    receive() external payable {
        require(
            msg.sender == token || msg.sender == address(stableSwap),
            "only-weth-or-stableswap"
        );
    }
}
