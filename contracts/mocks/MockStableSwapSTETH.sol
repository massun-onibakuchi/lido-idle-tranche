// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IStableSwapSTETH.sol";

import "hardhat/console.sol";

contract MockStableSwapSTETH is IStableSwapSTETH {
    uint256 public priceTokenIInTokenJ = 10**18;
    address[] public coins;
    address private constant ETH_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

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
        address inputToken = coins[uint256(int256(i))];
        address outputToken = coins[uint256(int256(j))];
        require(inputToken != outputToken, "identical-token");
        if (outputToken == ETH_ADDRESS) {
            amountOut = _exchangeTokenForETH(
                IERC20(inputToken),
                dx,
                minDy,
                msg.sender
            );
        } else {
            revert("no-implementation");
        }
    }

    function _exchangeTokenForETH(
        IERC20 token,
        uint256 dx,
        uint256 minDy,
        address to
    ) internal returns (uint256 amountOut) {
        token.transferFrom(msg.sender, address(this), dx);
        amountOut = (dx * priceTokenIInTokenJ) / 10**18;
        console.log("dx :>>", dx);
        console.log("amountOut :>>", amountOut);
        require(
            token.balanceOf(address(this)) >= dx,
            "mock-stableswap-input-token-balance-error"
        );
        require(
            address(this).balance >= amountOut,
            "mock-stableswap-ouput-balance-error"
        );
        require(amountOut >= minDy, "mock-stableswap-slip");

        (bool sent, bytes memory data) = payable(to).call{value: amountOut}("");
        require(sent, "Failed to send Ether");
    }

    receive() external payable {}
}
