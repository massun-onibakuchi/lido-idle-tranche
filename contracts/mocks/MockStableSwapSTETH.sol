// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IStableSwapSTETH.sol";

import "hardhat/console.sol";

contract MockStableSwapSTETH is IStableSwapSTETH {
    uint256 public priceTokenIInTokenJ = 10**18;
    address[] public coins;

    function setCoins(address[] memory _coins) external {
        for (uint256 i = 0; i < _coins.length; i++) {
            coins.push(_coins[i]);
        }
    }

    function setPriceTokenIInTokenJ(uint256 price) external {
        priceTokenIInTokenJ = price;
    }

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy
    ) public payable override returns (uint256 amountOut) {
          address  inputToken = coins[uint256(int256(i))];
          address  outputToken = coins[uint256(int256(j))];
        IERC20(inputToken).transferFrom(msg.sender, address(this), dx);
        amountOut = (dx * priceTokenIInTokenJ) / 10**18;
        require(
            IERC20(inputToken).balanceOf(address(this)) >= amountOut,
            "mock-stableswap-balance-error"
        );
        require(amountOut >= minDy, "mock-stableswap-slip");
        console.log("dx :>>", dx);
        console.log("amountOut :>>", amountOut);
        IERC20(outputToken).transfer(msg.sender, amountOut);
    }
}
