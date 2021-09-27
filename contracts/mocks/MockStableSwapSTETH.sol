// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockStableSwapSTETH {
    uint256 public priceTokenIInTokenJ = 10**18;
    address[] public coins;

    function setCoins(address[] memory _coins) external {
        for (uint256 i = 0; i < _coins.length; i++) {
            coins[i] = _coins[i];
        }
    }

    function setPriceTokenIInTokenJ(uint256 price) external {
        priceTokenIInTokenJ = price;
    }

    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 minDy
    ) public payable returns (uint256 amountOut) {
        // IERC20(coins[i]).transferFrom(msg.sender, address(this), dx);
        amountOut = (dx * priceTokenIInTokenJ) / 10**18;
        require(
            IERC20(coins[j]).balanceOf(address(this)) >= amountOut,
            "mock-stableswap-balance-error"
        );
        IERC20(coins[j]).transfer(msg.sender, amountOut);
    }
}
