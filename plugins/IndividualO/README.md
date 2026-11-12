# Individual O

**Individual O** is a Stash plugin for tracking individual O events for each performer across scenes and images.

It provides dedicated counters and histories, scene-marker integration, and optional synchronization with Stash's native O counters.

## Features

### Individual tracking
- Record an individual O for one or more performers in a scene.
- Record individual O events on images.
- Edit and delete existing entries.
- Keep individual attribution separate from Stash's native O counters.

### Performer counters
- Display individual O totals on performer profile pages and wall cards.
- Open an individual history directly from a counter.
- Sort performers by their individual O totals.

### Histories
- View individual O histories for scenes and images.
- Browse a global history with filters and chronological sorting.
- Edit or delete entries from the available history views.
- Return to the associated scene or image, including video timestamps when available.

### Scene-marker integration
- Associate an entry with an existing scene marker.
- Optionally offer to create a marker when recording an individual O.
- Display individual counts alongside supported marker previews and history entries.

### Native Stash counter synchronization

Synchronization is configurable:
- **Scenes:** create a native Stash O event when an individual O is recorded using the current date and time.
- **Images:** increment the native image O counter when an individual O is recorded.

## Configuration

The plugin settings let you control:
- Visibility of individual performer counters.
- Visibility of native Stash performer O counters.
- Visibility of counters in scene and image histories and marker displays.
- Visibility of edit and delete actions in sidebar histories.
- Whether marker creation is offered.
- Whether native scene and image O counters are synchronized.

## Installation

1. In Stash, open **Settings → Plugins**.
2. Add this plugin source:

   `https://xwanda23x.github.io/stash-individual-o/main/index.yml`

3. Find **Individual O** in the available plugins.
4. Install and enable the plugin.
5. Open the plugin settings to configure its behavior.

## Data storage

Individual O history is stored in Stash's database using custom fields associated with scenes and images.

Individual attribution data is kept separate from Stash's native O history and counters. Existing entries are retained when updating the plugin.

## Compatibility

- Tested with Stash **v0.31.1**.

## Links

- [GitHub repository](https://github.com/xwanda23x/stash-individual-o)
- [Plugin source index](https://xwanda23x.github.io/stash-individual-o/main/index.yml)

## Author

**xwanda23x**
