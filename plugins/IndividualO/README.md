# Individual O

**Individual O** is a Stash plugin that lets you record and track individual O events for performers across scenes and images.

It maintains individual attribution separately from Stash's native O counters, with optional synchronization.

## Features

- **Individual O tracking:** Assign an individual O event to one or multiple performers in a scene.
- **Image support:** Record and manage individual O events associated with images.
- **Performer counters:** Display individual O totals on performer profiles and performer cards.
- **Detailed history:** Browse individual O records, dates, associated scenes and images.
- **Global history:** Access individual O records with filtering and management options.
- **Marker integration:** Associate individual O events with Stash Splooge markers.
- **Native counter synchronization:** Optionally create or increment native Stash O counters when recording individual events.
- **Interface customization:** Choose which counters and history controls are displayed.

## Installation

1. Download the latest release of Individual O.
2. Extract the archive.
3. Copy the `IndividualO` folder into your Stash plugins directory.
4. In Stash, open **Settings → Plugins**.
5. Click **Reload Plugins**.
6. The plugin should now be available in your Stash interface.

To update, replace the existing plugin files with the new version and reload plugins.

## Configuration

The plugin provides several settings:

| Setting | Description |
|---|---|
| Hide Edit/Delete buttons | Hides modification and deletion controls in scene and image side histories. |
| Sync classic scene O | Creates a native Stash O event when an individual O is recorded using the current date and time. |
| Sync classic image O | Increments the native image O counter when an individual O is recorded. |
| Hide individual counters | Hides individual counters on performer profiles and cards. |
| Hide history and marker counters | Hides counters in side histories and Splooge markers. |
| Hide classic performer counters | Hides native Stash O counters on performer profiles and cards. |
| Offer automatic marker creation | Offers to create a Splooge marker when no matching marker is selected. |
| Automatic marker title | Defines the title used for automatically created markers and for finding existing markers. |
| Marker primary tag | Defines the existing Stash tag assigned to automatically created markers. |

Native synchronization options are disabled by default.

## Data and compatibility

Individual O records are stored in Stash data and remain separate from native O counters.

The plugin uses Stash's GraphQL API and interface components.

**Tested with:** Stash v0.31.1.

## Version

Current version: **0.8.0**

## License

AGPL-3.0
