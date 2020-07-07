const { ether, BN, expectRevert, expectEvent, constants, time, balance, send } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const { ethers } = require('ethers');

const EasyStaking = artifacts.require('EasyStaking');
const EasyStakingMock = artifacts.require('EasyStakingMock');
const ReceiverMock = artifacts.require('ReceiverMock');
const Token = artifacts.require('ERC677Mock');
const ExtendedMathMock = artifacts.require('ExtendedMathMock');

contract('PoaMania', accounts => {
  const [owner, user1, user2] = accounts;
  const YEAR = new BN(31536000); // in seconds
  const MAX_EMISSION_RATE = ether('0.15'); // 15%
  const fee = ether('0.03'); // 3%
  const withdrawalLockDuration = new BN(600); // in seconds
  const withdrawalUnlockDuration = new BN(60); // in seconds
  const sigmoidParamA = ether('0.075'); // 7.5%
  const sigmoidParamB = new BN(0);
  const sigmoidParamC = new BN(10000000000000);
  const oneEther = ether('1');
  const totalSupplyFactor = ether('1');

  let easyStaking;
  let stakeToken;
  let liquidityProvidersRewardAddress = user2;

  const initializeMethod = 'initialize(address,address,address,uint256,uint256,uint256,uint256,uint256,int256,uint256)';

  function initialize(...params) {
    if (params.length === 0) {
      params = [
        owner,
        stakeToken.address,
        liquidityProvidersRewardAddress,
        fee.toString(),
        withdrawalLockDuration.toString(),
        withdrawalUnlockDuration.toString(),
        totalSupplyFactor.toString(),
        sigmoidParamA.toString(),
        sigmoidParamB.toString(),
        sigmoidParamC.toString(),
      ];
    }
    return easyStaking.methods[initializeMethod](...params, { from: owner });
  }

  function squareRoot(y) {
    let z = new BN(0);
    if (y.gt(new BN(3))) {
      z = y;
      let x = y.div(new BN(2)).add(new BN(1));
      while (x.lt(z)) {
        z = x;
        x = y.div(x).add(x).div(new BN(2));
      }
    } else if (!y.isZero()) {
      z = new BN(1);
    }
    return z;
  }

  function calculateSupplyBasedEmissionRate(totalSupply, totalStaked, factor = totalSupplyFactor) {
    return MAX_EMISSION_RATE.div(new BN(2)).mul(totalStaked).div(totalSupply.mul(factor).div(oneEther));
  }

  function calculateUserAccruedEmission(deposit, timePassed, totalSupply, totalStaked) {
    let userEmissionRate = sigmoidParamA.mul(timePassed.sub(sigmoidParamB)).div(squareRoot(timePassed.sub(sigmoidParamB).sqr().add(sigmoidParamC)));
    if (userEmissionRate.lt(new BN(0))) {
      userEmissionRate = new BN(0);
    }
    const emissionRateBasedOnTotalStakedAmount = calculateSupplyBasedEmissionRate(totalSupply, totalStaked);
    userEmissionRate = userEmissionRate.add(emissionRateBasedOnTotalStakedAmount);
    return deposit.mul(userEmissionRate).div(oneEther).mul(timePassed).div(YEAR);
  }

  async function getBlockTimestamp(receipt) {
    return new BN((await web3.eth.getBlock(receipt.receipt.blockNumber)).timestamp);
  }

  beforeEach(async () => {
    stakeToken = await Token.new();
    easyStaking = await EasyStaking.new();
    liquidityProvidersRewardContract = await ReceiverMock.new();
    await initialize();
    await stakeToken.initialize('Stake', 'STAKE', 18, 0, owner, [owner, easyStaking.address], [], easyStaking.address);
  });

  describe('initialize', () => {
    it('should be set up correctly', async () => {
      expect(await easyStaking.token()).to.equal(stakeToken.address);
      const params = await easyStaking.getSigmoidParameters();
      expect(params.a).to.be.bignumber.equal(sigmoidParamA);
      expect(params.b).to.be.bignumber.equal(sigmoidParamB);
      expect(params.c).to.be.bignumber.equal(sigmoidParamC);
    });
    it('fails if any of parameters is incorrect', async () => {
      easyStaking = await EasyStaking.new();
      await expectRevert(
        initialize(
          constants.ZERO_ADDRESS,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'zero address'
      );
      await expectRevert(
        initialize(
          owner,
          constants.ZERO_ADDRESS,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'not a contract address'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          ether('1.01').toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to 1 ether'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          ether('1.01').toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to 1 ether'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          0,
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be greater than 0'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          0,
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be greater than 0'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          ether('0.076').toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to a half of the maximum emission rate'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          constants.ZERO_ADDRESS,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'zero address'
      );
    });
  });
  function testDeposit(directly) {
    beforeEach(async () => {
      await stakeToken.mint(user1, ether('1000'), { from: owner });
      await stakeToken.approve(easyStaking.address, ether('10000'), { from: user1 });
    });
    it('should deposit', async () => {
      const value = ether('100');
      let receipt;
      if (directly) {
        receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
        expectEvent(receipt, 'Deposited', {
          sender: user1,
          amount: value,
          id: new BN(1),
          balance: value,
          accruedEmission: new BN(0),
          prevDepositDuration: new BN(0),
        });
      } else {
        receipt = await stakeToken.transfer(easyStaking.address, value, { from: user1 });
      }
      const timestamp = await getBlockTimestamp(receipt);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value);
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestamp);
    });
    it('should accrue emission', async () => {
      const value = ether('100');
      let receipt;
      if (directly) {
        receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      } else {
        receipt = await stakeToken.transfer(easyStaking.address, value, { from: user1 });
      }
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.methods['deposit(uint256,uint256)'](1, value, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      if (directly) {
        expectEvent(receipt, 'Deposited', {
          sender: user1,
          amount: value,
          id: new BN(1),
          balance: value.add(value).add(userAccruedEmission),
          accruedEmission: userAccruedEmission,
          prevDepositDuration: new BN(timePassed),
        });
      }
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.add(value).add(userAccruedEmission));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestampAfter);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(value.add(value).add(userAccruedEmission));
    });
    it('should deposit using an old id', async () => {
      await easyStaking.setFee(0, { from: owner });
      const value = ether('100');
      if (directly) {
        await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
        await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      } else {
        await stakeToken.transfer(easyStaking.address, value, { from: user1 });
        await stakeToken.transfer(easyStaking.address, value, { from: user1 });
      }
      await time.increase(YEAR);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      await easyStaking.makeForcedWithdrawal(2, 0, { from: user1 });
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.balances(user1, 2)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.depositDates(user1, 2)).to.be.bignumber.equal(new BN(0));

      let receipt = await easyStaking.methods['deposit(uint256,uint256)'](1, value, { from: user1 });
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value);
      const timestampBefore = await getBlockTimestamp(receipt);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      const balanceBefore = await stakeToken.balanceOf(user1);
      await time.increase(YEAR);
      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      const balanceAfter = await stakeToken.balanceOf(user1);
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.add(userAccruedEmission),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission,
        lastDepositDuration: timePassed,
      });
      expect(balanceAfter).to.be.bignumber.equal(balanceBefore.add(value.add(userAccruedEmission)));
    });
    it('fails if deposit value is zero', async () => {
      if (directly) {
        await expectRevert(
          easyStaking.methods['deposit(uint256)'](0, { from: user1 }),
          'deposit amount should be more than 0'
        );
      } else {
        await expectRevert(
          stakeToken.transfer(easyStaking.address, 0, { from: user1 }),
          `you can't transfer to bridge contract` // if onTokenTransfer() fails
        );
      }
    });
  }
  describe('deposit', () => {
    testDeposit(true);
    it('fails if wrong deposit id', async () => {
      await expectRevert(
        easyStaking.methods['deposit(uint256,uint256)'](1, ether('100'), { from: user1 }),
        'wrong deposit id'
      );
    });
  });
  describe('onTokenTransfer', () => {
    testDeposit(false);
    it('fails if not a token address', async () => {
      await expectRevert(
        easyStaking.onTokenTransfer(user1, ether('1'), '0x', { from: owner }),
        'only token contract is allowed'
      );
    });
  });
  describe('makeForcedWithdrawal', () => {
    const value = ether('1000');
    beforeEach(async () => {
      await stakeToken.mint(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, ether('10000'), { from: user1 });
    });
    it('should withdraw', async () => { 
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      let timestampBefore = await getBlockTimestamp(receipt);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(value);
      let totalSupply = await stakeToken.totalSupply();
      let totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, oneEther, { from: user1 });
      let timestampAfter = await getBlockTimestamp(receipt);
      let timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission1 = calculateUserAccruedEmission(oneEther, timePassed, totalSupply, totalStaked);
      const feeValue1 = oneEther.add(userAccruedEmission1).mul(fee).div(oneEther);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.sub(oneEther));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestampBefore);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(value.sub(oneEther));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(oneEther.add(userAccruedEmission1).sub(feeValue1));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: oneEther.add(userAccruedEmission1).sub(feeValue1),
        id: new BN(1),
        balance: value.sub(oneEther),
        accruedEmission: userAccruedEmission1,
        lastDepositDuration: timePassed,
        fee: feeValue1,
      });
      timestampAfter = timestampBefore;
      totalSupply = await stakeToken.totalSupply();
      totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      timestampAfter = await getBlockTimestamp(receipt);
      timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission2 = calculateUserAccruedEmission(value.sub(oneEther), timePassed, totalSupply, totalStaked);
      const feeValue2 = value.sub(oneEther).add(userAccruedEmission2).mul(fee).div(oneEther);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      const expectedBalance = value.add(userAccruedEmission1).add(userAccruedEmission2).sub(feeValue1).sub(feeValue2);
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(expectedBalance);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(new BN(0));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.sub(oneEther).add(userAccruedEmission2).sub(feeValue2),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission2,
        lastDepositDuration: timestampAfter.sub(timestampBefore),
        fee: feeValue2,
      });
    });
    it('should withdraw with accrued emission', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      const feeValue = value.add(userAccruedEmission).mul(fee).div(oneEther);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(value.add(userAccruedEmission).sub(feeValue));
    });
    it('should withdraw part and accrue emission', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, oneEther, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(oneEther, timePassed, totalSupply, totalStaked);
      const feeValue = oneEther.add(userAccruedEmission).mul(fee).div(oneEther);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.sub(oneEther));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(oneEther.add(userAccruedEmission).sub(feeValue));
    });
    it('should accrue emission for different users from 1 address', async () => {
      const exchange = user1;
      const values = [ether('100'), ether('250'), ether('600')];
      const MONTH = 2592000; // in seconds
      for (let i = 0; i < 3; i++) {
        await easyStaking.methods['deposit(uint256)'](values[i], { from: exchange });
        expect(await easyStaking.balances(exchange, i + 1)).to.be.bignumber.equal(values[i]);
      }
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(values.reduce((acc, cur) => acc.add(cur), new BN(0)));
      let exchangeBalance = await stakeToken.balanceOf(exchange);
      await time.increase(MONTH * 4);
      for (let i = 0; i < 3; i++) {
        const timestampBefore = await easyStaking.depositDates(exchange, i + 1);
        const totalSupply = await stakeToken.totalSupply();
        const totalStaked = await easyStaking.totalStaked();
        const receipt = await easyStaking.makeForcedWithdrawal(i + 1, 0, { from: user1 });
        const timestampAfter = await getBlockTimestamp(receipt);
        const timePassed = timestampAfter.sub(timestampBefore);
        const userAccruedEmission = calculateUserAccruedEmission(values[i], timePassed, totalSupply, totalStaked);
        const feeValue = values[i].add(userAccruedEmission).mul(fee).div(oneEther);
        const expectedExchangeBalance = exchangeBalance.add(values[i]).add(userAccruedEmission).sub(feeValue);
        expect(userAccruedEmission).to.be.bignumber.gt(new BN(0));
        expect(await easyStaking.balances(exchange, i + 1)).to.be.bignumber.equal(new BN(0));
        expect(await stakeToken.balanceOf(exchange)).to.be.bignumber.equal(expectedExchangeBalance);
        exchangeBalance = expectedExchangeBalance;
        await time.increase(MONTH * 4);
      }
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(new BN(0));
    });
    it('fails if trying to withdraw more than deposited', async () => {
      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await time.increase(YEAR);
      await expectRevert(
        easyStaking.makeForcedWithdrawal(1, ether('10.000000000000000001'), { from: user1 }),
        'SafeMath: subtraction overflow'
      );
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
    });
    it('fails if wrong deposit id', async () => {
      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await expectRevert(
        easyStaking.makeForcedWithdrawal(2, ether('10'), { from: user1 }),
        'wrong deposit id'
      );
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
    });
    it('fails if zero balance', async () => {
      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
      await expectRevert(
        easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 }),
        'zero balance'
      );
    });
  });
  describe('requestWithdrawal', () => {
    it('should request', async () => {
      const value = ether('1000');
      await stakeToken.mint(user1, value, { from: owner });
      await stakeToken.transfer(easyStaking.address, value, { from: user1 });
      const receipt = await easyStaking.requestWithdrawal(1, { from: user1 });
      const timestamp = await getBlockTimestamp(receipt);
      expect(await easyStaking.withdrawalRequestsDates(user1, 1)).to.be.bignumber.equal(timestamp);
    });
    it('fails if wrong deposit id', async () => {
      await expectRevert(easyStaking.requestWithdrawal(1, { from: user1 }), 'wrong deposit id');
    });
  });
  describe('makeRequestedWithdrawal', () => {
    const value = ether('1000');
    beforeEach(async () => {
      await stakeToken.mint(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, ether('10000'), { from: user1 });
    });
    it('should withdraw', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      expect(await easyStaking.withdrawalRequestsDates(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(value.add(userAccruedEmission));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.add(userAccruedEmission),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission,
        lastDepositDuration: timePassed,
      });
    });
    it('should fail if not requested', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), `withdrawal wasn't requested`);
    });
    it('should fail if too early', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration.sub(new BN(5)));
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), 'too early');
    });
    it('should fail if too late', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration.add(new BN(86400)));
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), 'too late');
    });
  });
  describe('setFee', () => {
    it('should set', async () => {
      const newFee = ether('0.1');
      expect(await easyStaking.fee()).to.be.bignumber.equal(fee);
      expect(newFee).to.be.bignumber.not.equal(fee);
      await easyStaking.setFee(newFee, { from: owner });
      expect(await easyStaking.fee()).to.be.bignumber.equal(newFee);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setFee(ether('0.1'), { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if greater than 1 ether', async () => {
      await expectRevert(easyStaking.setFee(ether('1.01'), { from: owner }), 'should be less than or equal to 1 ether');
    });
  });
  describe('setWithdrawalLockDuration', () => {
    it('should set', async () => {
      const newWithdrawalLockDuration = new BN(1000);
      expect(await easyStaking.withdrawalLockDuration()).to.be.bignumber.equal(withdrawalLockDuration);
      expect(newWithdrawalLockDuration).to.be.bignumber.not.equal(withdrawalLockDuration);
      await easyStaking.setWithdrawalLockDuration(newWithdrawalLockDuration, { from: owner });
      expect(await easyStaking.withdrawalLockDuration()).to.be.bignumber.equal(newWithdrawalLockDuration);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setWithdrawalLockDuration(new BN(1000), { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if equal to zero', async () => {
      await expectRevert(easyStaking.setWithdrawalLockDuration(0, { from: owner }), 'should be greater than 0');
    });
  });
  describe('setWithdrawalUnlockDuration', () => {
    it('should set', async () => {
      const newWithdrawalUnlockDuration = new BN(100);
      expect(await easyStaking.withdrawalUnlockDuration()).to.be.bignumber.equal(withdrawalUnlockDuration);
      expect(newWithdrawalUnlockDuration).to.be.bignumber.not.equal(withdrawalUnlockDuration);
      await easyStaking.setWithdrawalUnlockDuration(newWithdrawalUnlockDuration, { from: owner });
      expect(await easyStaking.withdrawalUnlockDuration()).to.be.bignumber.equal(newWithdrawalUnlockDuration);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setWithdrawalUnlockDuration(new BN(100), { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if equal to zero', async () => {
      await expectRevert(easyStaking.setWithdrawalUnlockDuration(0, { from: owner }), 'should be greater than 0');
    });
  });
  describe('setTotalSupplyFactor', () => {
    it('should set', async () => {
      const newTotalSupplyFactor = ether('0.9');
      expect(await easyStaking.totalSupplyFactor()).to.be.bignumber.equal(totalSupplyFactor);
      expect(newTotalSupplyFactor).to.be.bignumber.not.equal(totalSupplyFactor);
      await easyStaking.setTotalSupplyFactor(newTotalSupplyFactor, { from: owner });
      expect(await easyStaking.totalSupplyFactor()).to.be.bignumber.equal(newTotalSupplyFactor);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setTotalSupplyFactor(ether('0.9'), { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if greater than 1 ether', async () => {
      await expectRevert(
        easyStaking.setTotalSupplyFactor(ether('1.01'), { from: owner }),
        'should be less than or equal to 1 ether'
      );
    });
  });
  describe('setSigmoidParameters', () => {
    it('should set', async () => {
      const newSigmoidParams = { a: ether('0.065'), b: new BN(10000), c: new BN(999999) };
      let sigmoidParams = await easyStaking.getSigmoidParameters();
      expect(sigmoidParams.a).to.be.bignumber.equal(sigmoidParamA);
      expect(sigmoidParams.b).to.be.bignumber.equal(sigmoidParamB);
      expect(sigmoidParams.c).to.be.bignumber.equal(sigmoidParamC);
      await easyStaking.setSigmoidParameters(newSigmoidParams.a, newSigmoidParams.b, newSigmoidParams.c, { from: owner });
      sigmoidParams = await easyStaking.getSigmoidParameters();
      expect(sigmoidParams.a).to.be.bignumber.equal(newSigmoidParams.a);
      expect(sigmoidParams.b).to.be.bignumber.equal(newSigmoidParams.b);
      expect(sigmoidParams.c).to.be.bignumber.equal(newSigmoidParams.c);
    });
    it('fails if not an owner', async () => {
      const newSigmoidParams = { a: ether('0.065'), b: new BN(10000), c: new BN(999999) };
      await expectRevert(
        easyStaking.setSigmoidParameters(newSigmoidParams.a, newSigmoidParams.b, newSigmoidParams.c, { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if wrong values', async () => {
      await expectRevert(
        easyStaking.setSigmoidParameters(ether('0.076'), sigmoidParamB, sigmoidParamC),
        'should be less than or equal to a half of the maximum emission rate'
      );
      await expectRevert(easyStaking.setSigmoidParameters(sigmoidParamA, sigmoidParamB, 0), 'should be greater than 0');
    });
  });
  describe('setLiquidityProvidersRewardAddress', () => {
    it('should set', async () => {
      const newLiquidityProvidersRewardAddress = user1;
      expect(await easyStaking.liquidityProvidersRewardAddress()).to.be.bignumber.equal(liquidityProvidersRewardAddress);
      expect(newLiquidityProvidersRewardAddress).to.be.bignumber.not.equal(liquidityProvidersRewardAddress);
      await easyStaking.setLiquidityProvidersRewardAddress(newLiquidityProvidersRewardAddress, { from: owner });
      expect(await easyStaking.liquidityProvidersRewardAddress()).to.be.bignumber.equal(newLiquidityProvidersRewardAddress);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setLiquidityProvidersRewardAddress(user1, { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if equal to zero', async () => {
      await expectRevert(
        easyStaking.setLiquidityProvidersRewardAddress(constants.ZERO_ADDRESS, { from: owner }),
        'zero address'
      );
    });
  });
  describe('claimTokens', () => {
    it('should claim tokens', async () => {
      const value = ether('10');
      const anotherToken = await Token.new();
      await anotherToken.initialize('Some token', 'TOKEN', 18, 0, owner, [owner], []);
      await anotherToken.mint(user1, value, { from: owner });
      expect(await anotherToken.balanceOf(user1)).to.be.bignumber.equal(value);
      await anotherToken.transfer(easyStaking.address, value, { from: user1 });
      expect(await anotherToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(value);
      expect(await anotherToken.balanceOf(owner)).to.be.bignumber.equal(new BN(0));
      await easyStaking.claimTokens(anotherToken.address, owner, { from: owner });
      expect(await anotherToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      expect(await anotherToken.balanceOf(owner)).to.be.bignumber.equal(value);
    });
    it('should claim STAKE tokens', async () => {
      await stakeToken.mint(easyStaking.address, ether('10'), { from: owner });
      await stakeToken.mint(user1, ether('100'), { from: owner });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('10'));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(ether('100'));
      await stakeToken.transfer(easyStaking.address, ether('100'), { from: user1 });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('110'));
      expect(await stakeToken.balanceOf(owner)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(ether('100'));
      await easyStaking.claimTokens(stakeToken.address, owner, { from: owner });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('100'));
      expect(await stakeToken.balanceOf(owner)).to.be.bignumber.equal(ether('10'));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(ether('100'));
      await expectRevert(easyStaking.claimTokens(stakeToken.address, owner, { from: owner }), 'nothing to claim');
    });
    async function claimEtherAndSend(to) {
      easyStaking = await EasyStakingMock.new();
      await initialize();
      const value = ether('10');
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      await send.ether(user1, easyStaking.address, value);
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(value);
      const balanceBefore = await balance.current(to);
      await easyStaking.claimTokens(constants.ZERO_ADDRESS, to, { from: owner, gasPrice: 0 });
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      expect(await balance.current(to)).to.be.bignumber.equal(balanceBefore.add(value));
    }
    it('should claim ether', async () => {
      await claimEtherAndSend(owner)
    });
    it('should claim and send ether even if receiver reverts it', async () => {
      const receiver = await ReceiverMock.new();
      await claimEtherAndSend(receiver.address);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, owner, { from: user1 }),
        'Ownable: caller is not the owner',
      );
    });
    it('fails if invalid recipient', async () => {
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, { from: owner }),
        'not a valid recipient',
      );
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, easyStaking.address, { from: owner }),
        'not a valid recipient',
      );
    });
  });
  describe('getSupplyBasedEmissionRate', () => {
    it('should be calculated correctly', async () => {
      const value = ether('3000000');
      const totalSupply = ether('8537500');
      await stakeToken.mint(owner, totalSupply, { from: owner });
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, value, { from: user1 });
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const totalStaked = value;
      const supplyBasedEmissionRate1 = calculateSupplyBasedEmissionRate(totalSupply, totalStaked);
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(supplyBasedEmissionRate1);
      const newTotalSupplyFactor = ether('0.7');
      await easyStaking.setTotalSupplyFactor(newTotalSupplyFactor);
      const supplyBasedEmissionRate2 = calculateSupplyBasedEmissionRate(totalSupply, totalStaked, newTotalSupplyFactor);
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(supplyBasedEmissionRate2);
      expect(supplyBasedEmissionRate1).to.be.bignumber.equal(supplyBasedEmissionRate2.mul(newTotalSupplyFactor).div(oneEther))
    });
  });
  describe('getAccruedEmission', () => {
    it('should be calculated correctly', async () => {
      const value = ether('100');
      await stakeToken.mint(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, value, { from: user1 });
      const receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      await time.advanceBlock();
      const timestampAfter = await time.latest();
      const timePassed = timestampAfter.sub(timestampBefore);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      const depositDate = await easyStaking.depositDates(user1, 1);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      expect((await easyStaking.getAccruedEmission(depositDate, value)).userShare).to.be.bignumber.equal(userAccruedEmission);
    });
  });
  describe('ExtendedMath', () => {
    let extendedMath;
    beforeEach(async () => {
      extendedMath = await ExtendedMathMock.new();
    });
    it('sqrt should be within the gas limit and calculated correctly', async () => {
      const { receipt } = await extendedMath.sqrt(constants.MAX_UINT256);
      const expectedValue = squareRoot(constants.MAX_UINT256);
      expect(receipt.gasUsed).to.be.lt(100000);
      expect(await extendedMath.squareRoot()).to.be.bignumber.equal(expectedValue);
    });
    it('sqrt of 0-3', async () => {
      await extendedMath.sqrt(0);
      expect(await extendedMath.squareRoot()).to.be.bignumber.equal(new BN(0));
      for(let i = 1; i < 4; i++) {
        await extendedMath.sqrt(i);
        expect(await extendedMath.squareRoot()).to.be.bignumber.equal(new BN(1));
      }
    });
    it('pow2 of 0', async () => {
      await extendedMath.pow2(0);
      expect(await extendedMath.squaredValue()).to.be.bignumber.equal(new BN(0));
    });
  });
});
