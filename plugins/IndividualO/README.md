
name: Individual O
description: Track individual O events for performers across scenes and images, with dedicated histories, counters, marker integration, and optional synchronization with Stash's native O counters.
version: "0.8.2"
ui:
  javascript:
    - individual-o.js
  css:
    - individual-o.css

settings:
  hideSidebarActions:
    displayName: Hide Edit / Delete Buttons
    description: "Hide edit and delete buttons in scene and image sidebar histories. Disabled by default: the buttons remain visible."
    type: BOOLEAN
  syncClassicSceneO:
    displayName: Automatically Create Classic O on Scenes
    description: "When enabled, a native Stash O event is created alongside an individual O recorded using the current date and time. When disabled, only the individual O is recorded."
    type: BOOLEAN
  syncClassicImageO:
    displayName: Automatically Create Classic O on Images
    description: "When enabled, the native Stash O counter for an image is incremented alongside an individual O. When disabled, only the individual O is recorded."
    type: BOOLEAN
  hideIndividualCounters:
    displayName: Hide Individual Counters
    description: "Hide individual counters on performer profiles and wall cards. Disabled by default: the counters remain visible."
    type: BOOLEAN
  hideHistoryMarkerCounters:
    displayName: Hide History and Splooge Marker Counters
    description: "Hide counters in scene and image sidebar histories, on Splooge markers, and on their previews. Disabled by default: the counters remain visible."
    type: BOOLEAN
  hideClassicPerformerCounters:
    displayName: Hide Native Stash Performer O Counters
    description: "Hide the native Stash O icon and counter on performer profiles and wall cards. Disabled by default: the counters remain visible."
    type: BOOLEAN
  promptMarkerCreation:
    displayName: Offer Automatic Marker Creation
    description: "When no matching marker is selected, offer to create a marker and associate it with the individual O. When disabled, the individual O is saved without a marker and no prompt is shown."
    type: BOOLEAN
  newMarkerTitle:
    displayName: Automatically Created Marker Title
    description: "Title assigned to automatically created markers. The same title is used to find and display existing markers. Required; no default title is provided."
    type: STRING
  newMarkerPrimaryTag:
    displayName: Primary Tag for Created Markers
    description: "The tag must already exist in Stash. Enter its exact name, including capitalization, accents, and spaces. Required; no default tag is provided."
    type: STRING
