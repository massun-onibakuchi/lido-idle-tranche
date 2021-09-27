// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.7;

interface IStableSwapSTETH {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy
    ) external payable returns (uint256 amountOut);
}
