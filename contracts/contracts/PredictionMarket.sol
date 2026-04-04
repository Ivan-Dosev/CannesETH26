// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionMarket
 * @notice AI-generated prediction markets settled in USDC on Arc.
 *
 * Flow:
 *  1. AI agent (Dynamic server wallet) calls createMarket() with a 0G storage hash
 *     containing the full market metadata + AI provenance.
 *  2. Human users call placeBet() to stake USDC on an outcome.
 *  3. After expiry, Chainlink CRE resolver calls resolveMarket() with the winning option.
 *  4. Winners call claimWinnings() to receive their proportional share of the pool.
 */
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    IERC20 public immutable usdc;

    /// @notice Dynamic server wallet address — the only address allowed to create markets
    address public aiAgent;

    /// @notice Chainlink CRE oracle address — the only address allowed to resolve markets
    address public chainlinkResolver;

    uint256 public constant MIN_BET = 1000;         // 0.001 USDC (6 decimals) — Arc micropayments
    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Market {
        string   question;
        string[] options;
        uint256  expiry;
        uint256  totalPool;
        uint256[] optionPools;
        uint256  winningOption;
        bool     resolved;
        bool     cancelled;
        /// @notice Root hash from 0G Storage — contains AI prompt, model id, sources, reasoning
        string   storageHash;
        address  creator;
    }

    struct Bet {
        uint256 amount;
        uint256 optionIndex;
        bool    claimed;
    }

    uint256 public marketCount;
    mapping(uint256 => Market)                        public markets;
    mapping(uint256 => mapping(address => Bet))       public bets;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        string          question,
        string[]        options,
        uint256         expiry,
        string          storageHash
    );
    event BetPlaced(
        uint256 indexed marketId,
        address indexed bettor,
        uint256         optionIndex,
        uint256         amount
    );
    event MarketResolved(uint256 indexed marketId, uint256 winningOption);
    event WinningsClaimed(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event MarketCancelled(uint256 indexed marketId);
    event AgentUpdated(address indexed newAgent);
    event ResolverUpdated(address indexed newResolver);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _aiAgent,
        address _chainlinkResolver
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Zero usdc");
        require(_aiAgent != address(0), "Zero agent");
        require(_chainlinkResolver != address(0), "Zero resolver");
        usdc              = IERC20(_usdc);
        aiAgent           = _aiAgent;
        chainlinkResolver = _chainlinkResolver;
    }

    // ─────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────

    modifier onlyAiAgent() {
        require(msg.sender == aiAgent, "Only AI agent");
        _;
    }

    modifier onlyChainlinkResolver() {
        require(msg.sender == chainlinkResolver, "Only Chainlink resolver");
        _;
    }

    // ─────────────────────────────────────────────────────────
    // Market lifecycle
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Called by the AI agent to publish a new market.
     * @param question    Human-readable question (e.g. "Will ETH close above $4k on June 1?")
     * @param options     Outcome labels (e.g. ["Yes", "No"])
     * @param expiry      Unix timestamp after which no more bets are accepted
     * @param storageHash 0G Storage root hash containing full AI provenance metadata
     */
    function createMarket(
        string   calldata   question,
        string[] calldata   options,
        uint256             expiry,
        string   calldata   storageHash
    ) external onlyAiAgent returns (uint256 marketId) {
        require(options.length >= 2 && options.length <= 10, "2-10 options required");
        require(expiry > block.timestamp + 30 seconds, "Expiry too soon");
        require(bytes(question).length > 0, "Empty question");
        require(bytes(storageHash).length > 0, "Empty storage hash");

        marketId = marketCount++;

        Market storage m = markets[marketId];
        m.question    = question;
        m.options     = options;
        m.expiry      = expiry;
        m.storageHash = storageHash;
        m.creator     = msg.sender;
        m.optionPools = new uint256[](options.length);

        emit MarketCreated(marketId, question, options, expiry, storageHash);
    }

    /**
     * @notice Place a USDC bet on an outcome.
     *         Each address may place exactly one bet per market.
     */
    function placeBet(
        uint256 marketId,
        uint256 optionIndex,
        uint256 amount
    ) external nonReentrant {
        Market storage m = markets[marketId];
        require(!m.resolved && !m.cancelled, "Market not active");
        require(block.timestamp < m.expiry,  "Betting closed");
        require(optionIndex < m.options.length, "Invalid option");
        require(amount >= MIN_BET,              "Bet below minimum");
        require(bets[marketId][msg.sender].amount == 0, "Already bet");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        bets[marketId][msg.sender] = Bet({
            amount:      amount,
            optionIndex: optionIndex,
            claimed:     false
        });

        m.totalPool                += amount;
        m.optionPools[optionIndex] += amount;

        emit BetPlaced(marketId, msg.sender, optionIndex, amount);
    }

    /**
     * @notice Called by Chainlink CRE after fetching the real-world outcome.
     */
    function resolveMarket(
        uint256 marketId,
        uint256 winningOption
    ) external onlyChainlinkResolver {
        Market storage m = markets[marketId];
        require(!m.resolved && !m.cancelled,       "Market not active");
        require(block.timestamp >= m.expiry,        "Not expired yet");
        require(winningOption < m.options.length,   "Invalid winning option");

        m.resolved      = true;
        m.winningOption = winningOption;

        emit MarketResolved(marketId, winningOption);
    }

    /**
     * @notice Winners call this to receive their payout.
     *         Payout = (userBet / winningOptionPool) * totalPool * (1 - fee)
     */
    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.resolved, "Not resolved");

        Bet storage b = bets[marketId][msg.sender];
        require(b.amount > 0,                       "No bet");
        require(!b.claimed,                         "Already claimed");
        require(b.optionIndex == m.winningOption,   "Not a winner");

        b.claimed = true;

        uint256 winningPool = m.optionPools[m.winningOption];
        uint256 grossPayout = (b.amount * m.totalPool) / winningPool;
        uint256 fee         = (grossPayout * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netPayout   = grossPayout - fee;

        usdc.safeTransfer(msg.sender, netPayout);
        usdc.safeTransfer(owner(),    fee);

        emit WinningsClaimed(marketId, msg.sender, netPayout);
    }

    // ─────────────────────────────────────────────────────────
    // Admin / emergency
    // ─────────────────────────────────────────────────────────

    /// @notice Cancel a market (e.g. Chainlink failed to resolve). Users can refund.
    function cancelMarket(uint256 marketId) external onlyOwner {
        Market storage m = markets[marketId];
        require(!m.resolved && !m.cancelled, "Market not active");
        m.cancelled = true;
        emit MarketCancelled(marketId);
    }

    /// @notice Refund bet on a cancelled market.
    function refundBet(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.cancelled, "Not cancelled");

        Bet storage b = bets[marketId][msg.sender];
        require(b.amount > 0, "No bet");
        require(!b.claimed,   "Already refunded");

        b.claimed = true;
        usdc.safeTransfer(msg.sender, b.amount);
    }

    function setAiAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "Zero address");
        aiAgent = _agent;
        emit AgentUpdated(_agent);
    }

    function setChainlinkResolver(address _resolver) external onlyOwner {
        require(_resolver != address(0), "Zero address");
        chainlinkResolver = _resolver;
        emit ResolverUpdated(_resolver);
    }

    // ─────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (
        string   memory  question,
        string[] memory  options,
        uint256          expiry,
        uint256          totalPool,
        uint256[] memory optionPools,
        uint256          winningOption,
        bool             resolved,
        bool             cancelled,
        string   memory  storageHash
    ) {
        Market storage m = markets[marketId];
        return (
            m.question,
            m.options,
            m.expiry,
            m.totalPool,
            m.optionPools,
            m.winningOption,
            m.resolved,
            m.cancelled,
            m.storageHash
        );
    }

    function getUserBet(uint256 marketId, address user) external view returns (
        uint256 amount,
        uint256 optionIndex,
        bool    claimed
    ) {
        Bet storage b = bets[marketId][user];
        return (b.amount, b.optionIndex, b.claimed);
    }

    function getActiveMarkets() external view returns (uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 0; i < marketCount; i++) {
            if (!markets[i].resolved && !markets[i].cancelled) count++;
        }
        ids = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < marketCount; i++) {
            if (!markets[i].resolved && !markets[i].cancelled) ids[j++] = i;
        }
    }
}
