// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.7;

interface IStETHPriceFeed {
    function safe_price()
        external
        view
        returns (uint256 price, uint256 timestamp);
}
