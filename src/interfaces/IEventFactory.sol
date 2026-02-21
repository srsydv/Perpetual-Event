// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEventFactory {
    struct EventInfo {
        string name;
        uint256 resolutionTime;
        address oracle;
        address market;
        bool resolved;
        bool outcome; // true = event happened, false = did not
        bool paused;
    }

    function createEvent(
        string calldata name,
        uint256 resolutionTime,
        address oracle
    ) external returns (uint256 eventId, address market);

    function resolveEvent(uint256 eventId, bool outcome) external;

    function pauseEvent(uint256 eventId) external;

    function unpauseEvent(uint256 eventId) external;

    function getEvent(uint256 eventId) external view returns (EventInfo memory);

    function eventCount() external view returns (uint256);
}
