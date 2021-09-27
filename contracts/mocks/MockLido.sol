// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockLido is ERC20("Staked ETH", "stETH") {
    address private oracle;
    uint256 public fee = 100;

    function getFee() external view returns (uint256) {
        return fee;
    }

    function getOracle() external view returns (address) {
        return oracle;
    }

    function setOracle(address _oracle) public {
        oracle = _oracle;
    }

    function submit(address _referral)
        public
        payable
        returns (uint256 sharesAmount)
    {
        address sender = msg.sender;
        uint256 deposit = msg.value;
        require(deposit != 0, "ZERO_DEPOSIT");

        uint256 sharesAmount = getSharesByPooledEth(deposit);
        if (sharesAmount == 0) {
            // totalControlledEther is 0: either the first-ever deposit or complete slashing
            // assume that shares correspond to Ether 1-to-1
            sharesAmount = deposit;
        }

        _mint(sender, sharesAmount);
    }

    function getSharesByPooledEth(uint256 _ethAmount)
        public
        view
        returns (uint256)
    {
        uint256 totalPooledEther = _getTotalPooledEther();
        if (totalPooledEther == 0) {
            return 0;
        } else {
            return (_ethAmount * totalSupply()) / totalPooledEther;
        }
    }

    // Simplified for testing
    function _getTotalPooledEther() internal view returns (uint256) {
        return address(this).balance;
    }

    function getPooledEthByShares(uint256 _sharesAmount)
        public
        view
        returns (uint256)
    {
        uint256 totalShares = totalSupply();
        if (totalShares == 0) {
            return 0;
        } else {
            return (_sharesAmount * _getTotalPooledEther()) / totalShares;
        }
    }
}
