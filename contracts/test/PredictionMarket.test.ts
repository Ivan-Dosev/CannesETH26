import { expect } from "chai";
import { ethers } from "hardhat";
import { PredictionMarket } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PredictionMarket", () => {
  let contract: PredictionMarket;
  let usdc: any;
  let owner: HardhatEthersSigner;
  let aiAgent: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const ONE_USDC = ethers.parseUnits("1", 6);
  const TEN_USDC = ethers.parseUnits("10", 6);

  beforeEach(async () => {
    [owner, aiAgent, resolver, alice, bob] = await ethers.getSigners();

    // Deploy a mock ERC20 for USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const Factory = await ethers.getContractFactory("PredictionMarket");
    contract = await Factory.deploy(
      await usdc.getAddress(),
      aiAgent.address,
      resolver.address
    ) as PredictionMarket;

    // Mint USDC for users
    await usdc.mint(alice.address, ethers.parseUnits("1000", 6));
    await usdc.mint(bob.address,   ethers.parseUnits("1000", 6));
    await usdc.connect(alice).approve(await contract.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await contract.getAddress(), ethers.MaxUint256);
  });

  async function createMarket(expiryOffset = 3600) {
    const expiry = (await time.latest()) + expiryOffset;
    return contract.connect(aiAgent).createMarket(
      "Will ETH close above $4000 on June 1?",
      ["Yes", "No"],
      expiry,
      "0g://QmTest123"
    );
  }

  it("only AI agent can create a market", async () => {
    const expiry = (await time.latest()) + 3600;
    await expect(
      contract.connect(alice).createMarket("Q", ["Yes", "No"], expiry, "hash")
    ).to.be.revertedWith("Only AI agent");
  });

  it("creates a market and emits MarketCreated", async () => {
    await expect(createMarket())
      .to.emit(contract, "MarketCreated")
      .withArgs(0, "Will ETH close above $4000 on June 1?", ["Yes", "No"], (v: any) => v > 0n, "0g://QmTest123");

    expect(await contract.marketCount()).to.equal(1);
  });

  it("users can place bets", async () => {
    await createMarket();
    await expect(contract.connect(alice).placeBet(0, 0, TEN_USDC))
      .to.emit(contract, "BetPlaced")
      .withArgs(0, alice.address, 0, TEN_USDC);

    const [amount] = await contract.getUserBet(0, alice.address);
    expect(amount).to.equal(TEN_USDC);
  });

  it("cannot bet twice on same market", async () => {
    await createMarket();
    await contract.connect(alice).placeBet(0, 0, TEN_USDC);
    await expect(contract.connect(alice).placeBet(0, 1, TEN_USDC))
      .to.be.revertedWith("Already bet");
  });

  it("only chainlink resolver can resolve", async () => {
    await createMarket();
    await time.increase(3601);
    await expect(contract.connect(alice).resolveMarket(0, 0))
      .to.be.revertedWith("Only Chainlink resolver");
  });

  it("winners can claim winnings", async () => {
    await createMarket();
    await contract.connect(alice).placeBet(0, 0, TEN_USDC); // bets YES
    await contract.connect(bob).placeBet(0, 1, TEN_USDC);   // bets NO

    await time.increase(3601);
    await contract.connect(resolver).resolveMarket(0, 0); // YES wins

    const aliceBefore = await usdc.balanceOf(alice.address);
    await contract.connect(alice).claimWinnings(0);
    const aliceAfter = await usdc.balanceOf(alice.address);

    // Alice gets 98% of total pool (10+10=20 USDC minus 2% fee)
    expect(aliceAfter - aliceBefore).to.equal(ethers.parseUnits("19.6", 6));

    await expect(contract.connect(bob).claimWinnings(0))
      .to.be.revertedWith("Not a winner");
  });
});
