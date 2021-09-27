// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "../interfaces/IStETHPriceFeed.sol";

contract MockStETHPriceFeed is IStETHPriceFeed {
    uint256 public price = 10**18;
    uint256 public timestamp = block.timestamp;

    // solhint-disable-next-line func-name-mixedcase
    function safe_price() external view override returns (uint256, uint256) {
        return (price, timestamp);
    }

    function setPrice(uint256 _price) public {
        price = _price;
        timestamp = block.timestamp;
    }
}
