(function () {
  'use strict';

  const PLUGIN_ID = 'individual-o';
  const FIELD_KEY = 'individual_o_history_v1';
  const MARKER_TOLERANCE_SECONDS = 2;
  const ROOT_ID = 'individual-o-root';
  const nativeFetch = window.fetch.bind(window);
  const individualSortCache = new Map();
  let individualSortCounts = null;
  let individualSortCountsPromise = null;
  let individualSortActive = false;
  let individualSortButton = null;
  let individualSortButtonContainer = null;
  let individualSortInterceptorInstalled = false;
  let lastSceneId = null;
  let lastPerformerId = null;
  let observer = null;
  let scanQueued = false;
  const performerHistoryCache = new Map();
  const markerCounterCache = new Map();
  let markerCounterScanQueued = false;

  function individualOIconHTML(extraClass) {
    // Exact Stash native three-droplet path, scaled inside a thin white outline circle.
    return '<svg class="individual-o-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle cx="18" cy="18" r="17" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" transform="translate(5.5 5.5) scale(0.69)" d="M22.855.758L7.875 7.024l12.537 9.733c2.633 2.224 6.377 2.937 9.77 1.518c4.826-2.018 7.096-7.576 5.072-12.413C33.232 1.024 27.68-1.261 22.855.758zm-9.962 17.924L2.05 10.284L.137 23.529a7.993 7.993 0 0 0 2.958 7.803a8.001 8.001 0 0 0 9.798-12.65zm15.339 7.015l-8.156-4.69l-.033 9.223c-.088 2 .904 3.98 2.75 5.041a5.462 5.462 0 0 0 7.479-2.051c1.499-2.644.589-6.013-2.04-7.523z"/></svg>';
  }

  const gql = async (query, variables) => {
    const response = await nativeFetch('/graphql', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw new Error('Erreur HTTP GraphQL : ' + response.status);
    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors.map(e => e.message).join('\n'));
    }
    return payload.data;
  };


  // Stash identifies a plugin by the basename of its YAML file. This plugin's
  // manifest is IndividualO.yml, so its settings live under configuration.plugins.IndividualO.
  const SETTINGS_PLUGIN_ID = 'IndividualO';
  const SIDEBAR_ACTIONS_SETTING = 'hideSidebarActions';
  const CLASSIC_SCENE_SYNC_SETTING = 'syncClassicSceneO';
  const CLASSIC_IMAGE_SYNC_SETTING = 'syncClassicImageO';
  const HIDE_INDIVIDUAL_COUNTERS_SETTING = 'hideIndividualCounters';
  const HIDE_HISTORY_MARKER_COUNTERS_SETTING = 'hideHistoryMarkerCounters';
  const HIDE_CLASSIC_PERFORMER_COUNTERS_SETTING = 'hideClassicPerformerCounters';
  const PROMPT_MARKER_CREATION_SETTING = 'promptMarkerCreation';
  const NEW_MARKER_TITLE_SETTING = 'newMarkerTitle';
  const NEW_MARKER_PRIMARY_TAG_SETTING = 'newMarkerPrimaryTag';

  const DEFAULT_ON_SETTINGS = [
    PROMPT_MARKER_CREATION_SETTING,
    CLASSIC_IMAGE_SYNC_SETTING,
    CLASSIC_SCENE_SYNC_SETTING
  ];
  let defaultSettingsInitializationPromise = null;

  async function initializeDefaultOnSettings() {
    if (defaultSettingsInitializationPromise) return defaultSettingsInitializationPromise;
    defaultSettingsInitializationPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const existing = plugins && plugins[SETTINGS_PLUGIN_ID];
        const config = existing && typeof existing === 'object' ? existing : {};
        const merged = Object.assign({}, config);
        let changed = false;

        DEFAULT_ON_SETTINGS.forEach((key) => {
          // Only initialize settings that have never been saved. Explicit user
          // choices (including false) must survive every plugin update.
          if (!Object.prototype.hasOwnProperty.call(config, key)) {
            merged[key] = true;
            changed = true;
          }
        });

        if (changed) {
          await gql(`mutation IndividualOInitializeDefaultSettings($input: Map!) {
            configurePlugin(plugin_id: "IndividualO", input: $input)
          }`, { input: merged });
          console.info('[Individual O] Default settings initialized.');
        }
      } catch (error) {
        console.warn('[Individual O] Unable to initialize default settings; existing settings were left unchanged.', error);
      }
    })();
    return defaultSettingsInitializationPromise;
  }
  let markerCreationPromptEnabled = false;
  let newMarkerTitle = '';
  let newMarkerPrimaryTag = '';
  let markerSettingsReadAt = 0;
  let markerSettingsPromise = null;

  async function loadMarkerSettings(force) {
    if (!force && Date.now() - markerSettingsReadAt < 1500) return;
    if (markerSettingsPromise) return markerSettingsPromise;
    markerSettingsPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const rawConfig = plugins && plugins[SETTINGS_PLUGIN_ID];
        const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const promptValue = config[PROMPT_MARKER_CREATION_SETTING];
        // The switch is OFF until the user explicitly enables it. This matches
        // Stash's empty/false first-install setting state.
        markerCreationPromptEnabled = promptValue === true || promptValue === 1 || String(promptValue).toLowerCase() === 'true' || String(promptValue) === '1';
        const createTitle = String(config[NEW_MARKER_TITLE_SETTING] ?? '').trim();
        const primaryTag = String(config[NEW_MARKER_PRIMARY_TAG_SETTING] ?? '').trim();
        newMarkerTitle = createTitle;
        newMarkerPrimaryTag = primaryTag;
      } catch (error) {
        // Fail safely: do not offer marker creation when settings cannot be read.
        console.warn('[Individual O] Lecture des paramètres de marqueurs impossible ; création automatique désactivée.', error);
        markerCreationPromptEnabled = false;
        newMarkerTitle = '';
        newMarkerPrimaryTag = '';
      }
      markerSettingsReadAt = Date.now();
    })();
    try { await markerSettingsPromise; }
    finally { markerSettingsPromise = null; }
  }
  let sidebarActionsHidden = false;
  let sidebarActionsSettingReadAt = 0;
  let sidebarActionsSettingPromise = null;

  async function areSidebarActionsVisible() {
    // A short cache avoids an extra GraphQL request for every render while
    // allowing Reload UI to pick up a changed setting immediately.
    if (Date.now() - sidebarActionsSettingReadAt < 1500) return !sidebarActionsHidden;
    if (sidebarActionsSettingPromise) return sidebarActionsSettingPromise;
    sidebarActionsSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[SIDEBAR_ACTIONS_SETTING];
        sidebarActionsHidden = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        sidebarActionsSettingReadAt = Date.now();
      } catch (error) {
        // Fail open: a settings read failure must never hide existing controls.
        console.warn('[Individual O] Lecture du paramètre hideSidebarActions impossible ; boutons affichés.', error);
        sidebarActionsHidden = false;
        sidebarActionsSettingReadAt = Date.now();
      }
      return !sidebarActionsHidden;
    })();
    try { return await sidebarActionsSettingPromise; }
    finally { sidebarActionsSettingPromise = null; }
  }

  let classicSceneSyncEnabled = false;
  let classicSceneSyncSettingReadAt = 0;
  let classicSceneSyncSettingPromise = null;

  async function isClassicSceneSyncEnabled() {
    if (Date.now() - classicSceneSyncSettingReadAt < 1500) return classicSceneSyncEnabled;
    if (classicSceneSyncSettingPromise) return classicSceneSyncSettingPromise;
    classicSceneSyncSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[CLASSIC_SCENE_SYNC_SETTING];
        // An unset BOOLEAN setting is displayed as OFF by Stash. Match that
        // visible state instead of silently enabling synchronization in JS.
        classicSceneSyncEnabled = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        classicSceneSyncSettingReadAt = Date.now();
      } catch (error) {
        // Fail closed: if the setting cannot be read, do not perform a native
        // scene O increment that the user may have explicitly disabled.
        console.warn('[Individual O] Lecture du paramètre syncClassicSceneO impossible ; synchronisation désactivée.', error);
        classicSceneSyncEnabled = false;
        classicSceneSyncSettingReadAt = Date.now();
      }
      return classicSceneSyncEnabled;
    })();
    try { return await classicSceneSyncSettingPromise; }
    finally { classicSceneSyncSettingPromise = null; }
  }

  let individualCountersHidden = false;
  let individualCountersSettingReadAt = 0;
  let individualCountersSettingPromise = null;

  async function areIndividualCountersVisible() {
    if (Date.now() - individualCountersSettingReadAt < 1500) return !individualCountersHidden;
    if (individualCountersSettingPromise) return individualCountersSettingPromise;
    individualCountersSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[HIDE_INDIVIDUAL_COUNTERS_SETTING];
        // The setting is inverted so its OFF/default state preserves today's visible counters.
        individualCountersHidden = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        individualCountersSettingReadAt = Date.now();
      } catch (error) {
        console.warn('[Individual O] Lecture du paramètre hideIndividualCounters impossible ; compteurs affichés.', error);
        individualCountersHidden = false;
        individualCountersSettingReadAt = Date.now();
      }
      return !individualCountersHidden;
    })();
    try { return await individualCountersSettingPromise; }
    finally { individualCountersSettingPromise = null; }
  }

  let historyMarkerCountersHidden = false;
  let historyMarkerCountersSettingReadAt = 0;
  let historyMarkerCountersSettingPromise = null;

  async function areHistoryMarkerCountersVisible() {
    if (Date.now() - historyMarkerCountersSettingReadAt < 1500) return !historyMarkerCountersHidden;
    if (historyMarkerCountersSettingPromise) return historyMarkerCountersSettingPromise;
    historyMarkerCountersSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[HIDE_HISTORY_MARKER_COUNTERS_SETTING];
        historyMarkerCountersHidden = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        historyMarkerCountersSettingReadAt = Date.now();
      } catch (error) {
        console.warn('[Individual O] Lecture du paramètre hideHistoryMarkerCounters impossible ; compteurs affichés.', error);
        historyMarkerCountersHidden = false;
        historyMarkerCountersSettingReadAt = Date.now();
      }
      return !historyMarkerCountersHidden;
    })();
    try { return await historyMarkerCountersSettingPromise; }
    finally { historyMarkerCountersSettingPromise = null; }
  }

  let classicPerformerCountersHidden = false;
  let classicPerformerCountersSettingReadAt = 0;
  let classicPerformerCountersSettingPromise = null;

  async function areClassicPerformerCountersVisible() {
    if (Date.now() - classicPerformerCountersSettingReadAt < 1500) return !classicPerformerCountersHidden;
    if (classicPerformerCountersSettingPromise) return classicPerformerCountersSettingPromise;
    classicPerformerCountersSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[HIDE_CLASSIC_PERFORMER_COUNTERS_SETTING];
        classicPerformerCountersHidden = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        classicPerformerCountersSettingReadAt = Date.now();
      } catch (error) {
        console.warn('[Individual O] Lecture du paramètre hideClassicPerformerCounters impossible ; compteurs classiques affichés.', error);
        classicPerformerCountersHidden = false;
        classicPerformerCountersSettingReadAt = Date.now();
      }
      return !classicPerformerCountersHidden;
    })();
    try { return await classicPerformerCountersSettingPromise; }
    finally { classicPerformerCountersSettingPromise = null; }
  }

  function applyClassicPerformerCounterVisibility(visible) {
    const selectors = '.performer-card .card-popovers svg path, #performer-page .quality-group svg path';
    document.querySelectorAll(selectors).forEach(path => {
      // Individual O intentionally reuses Stash's three-droplet path inside
      // a white circle. Exclude our own counters before matching the native glyph.
      if (path.closest('.individual-o-card-pill, #individual-o-performer-counter')) return;
      const d = (path.getAttribute('d') || '').trim();
      // Match Stash's native three-droplet O glyph, not the eye or other counters.
      if (!d.startsWith('M22.855.758L7.875')) return;
      const control = path.closest('.count-button') || path.closest('button') || path.closest('a');
      if (!control) return;
      control.classList.toggle('individual-o-native-o-counter-hidden', !visible);
    });
  }

  let classicImageSyncEnabled = false;
  let classicImageSyncSettingReadAt = 0;
  let classicImageSyncSettingPromise = null;

  async function isClassicImageSyncEnabled() {
    if (Date.now() - classicImageSyncSettingReadAt < 1500) return classicImageSyncEnabled;
    if (classicImageSyncSettingPromise) return classicImageSyncSettingPromise;
    classicImageSyncSettingPromise = (async () => {
      try {
        const data = await gql(`{ configuration { plugins } }`);
        const plugins = data && data.configuration && data.configuration.plugins;
        const config = plugins && plugins[SETTINGS_PLUGIN_ID];
        const value = config && config[CLASSIC_IMAGE_SYNC_SETTING];
        // Match Stash's visible OFF state when the BOOLEAN setting is unset.
        classicImageSyncEnabled = value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
        classicImageSyncSettingReadAt = Date.now();
      } catch (error) {
        console.warn('[Individual O] Lecture du paramètre syncClassicImageO impossible ; synchronisation désactivée.', error);
        classicImageSyncEnabled = false;
        classicImageSyncSettingReadAt = Date.now();
      }
      return classicImageSyncEnabled;
    })();
    try { return await classicImageSyncSettingPromise; }
    finally { classicImageSyncSettingPromise = null; }
  }

  function invalidateIndividualSortCache() {
    individualSortCache.clear();
    individualMarkerSortCache.clear();
    individualSortCounts = null;
    individualSortCountsPromise = null;
    globalHistoryCache = null;
  }

  function individualSortFilterKey(request) {
    return JSON.stringify({
      q: (request.variables && request.variables.filter && request.variables.filter.q) || '',
      performer_filter: request.variables && request.variables.performer_filter || {},
      performer_ids: request.variables && request.variables.performer_ids || null
    });
  }

  async function fetchFindPerformersPayload(input, init, request, page, pageSize) {
    const nextRequest = Object.assign({}, request, {
      variables: Object.assign({}, request.variables, {
        filter: Object.assign({}, request.variables && request.variables.filter, {
          page, per_page: pageSize, sort: 'name', direction: 'ASC'
        })
      })
    });
    const response = await nativeFetch(input, Object.assign({}, init, {
      body: JSON.stringify(nextRequest)
    }));
    const payload = await response.json();
    if (!response.ok) throw new Error('Erreur HTTP lors du chargement des performeurs : ' + response.status);
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors.map(error => error.message).join('\n'));
    }
    return payload;
  }

  async function loadAllFilteredPerformers(input, init, request) {
    const key = individualSortFilterKey(request);
    const cached = individualSortCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = (async () => {
      // 200 performeurs par page : environ 28 requêtes pour une bibliothèque de 5 525.
      const pageSize = 200;
      const first = await fetchFindPerformersPayload(input, init, request, 1, pageSize);
      const result = first && first.data && first.data.findPerformers;
      if (!result) throw new Error('Réponse FindPerformers invalide.');
      const total = Number(result.count) || 0;
      const performers = (result.performers || []).slice();
      const pageCount = Math.ceil(total / pageSize);
      const remainingPages = [];
      for (let page = 2; page <= pageCount; page++) remainingPages.push(page);
      // Limite la concurrence pour éviter de saturer l'instance Stash.
      for (let offset = 0; offset < remainingPages.length; offset += 5) {
        const batch = remainingPages.slice(offset, offset + 5);
        const payloads = await Promise.all(batch.map(page =>
          fetchFindPerformersPayload(input, init, request, page, pageSize)
        ));
        payloads.forEach(payload => {
          const data = payload && payload.data && payload.data.findPerformers;
          if (data && Array.isArray(data.performers)) performers.push(...data.performers);
        });
      }
      return { count: total, performers, basePayload: first };
    })();

    individualSortCache.set(key, { promise, expiresAt: Date.now() + 60000 });
    try {
      return await promise;
    } catch (error) {
      individualSortCache.delete(key);
      throw error;
    }
  }

  async function getIndividualSortCounts() {
    if (individualSortCounts) return individualSortCounts;
    if (individualSortCountsPromise) return individualSortCountsPromise;

    individualSortCountsPromise = (async () => {
      const first = await gql(`query IndividualOSortSceneCount {
        findScenes(filter: { per_page: 1, page: 1 }) { count }
      }`);
      const total = Number(first && first.findScenes && first.findScenes.count) || 0;
      const pageSize = 500;
      const pageCount = Math.ceil(total / pageSize);
      const counts = new Map();

      async function loadPage(page) {
        return gql(`query IndividualOSortScenePage($page: Int!, $perPage: Int!) {
          findScenes(filter: { per_page: $perPage, page: $page }) {
            scenes {
              custom_fields
              performers { id }
            }
          }
        }`, { page, perPage: pageSize });
      }

      // Les pages sont indépendantes : quatre requêtes simultanées réduisent
      // le temps d'attente sans envoyer une rafale excessive à Stash.
      const concurrency = 4;
      for (let offset = 1; offset <= pageCount; offset += concurrency) {
        const batch = [];
        for (let page = offset; page < Math.min(offset + concurrency, pageCount + 1); page++) {
          batch.push(loadPage(page));
        }
        const results = await Promise.all(batch);
        results.forEach(data => {
          const scenes = (data && data.findScenes && data.findScenes.scenes) || [];
          scenes.forEach(scene => {
            const raw = scene.custom_fields && scene.custom_fields[FIELD_KEY];
            if (!raw) return;
            let entries;
            try { entries = JSON.parse(raw); } catch (_) { return; }
            if (!Array.isArray(entries)) return;
            entries.forEach(entry => {
              (Array.isArray(entry.performer_ids) ? entry.performer_ids : []).forEach(id => {
                const key = String(id);
                counts.set(key, (counts.get(key) || 0) + 1);
              });
            });
          });
        });
      }

      // Les images contribuent au compteur des performers via le même index
      // local que l'historique Images. On ne parcourt jamais toute la bibliothèque.
      // Seules les images ayant déjà au moins un O individuel sont interrogées.
      const indexedImageIds = await readIndividualImageIndex();
      const imageBatchSize = 4;
      for (let offset = 0; offset < indexedImageIds.length; offset += imageBatchSize) {
        const batch = indexedImageIds.slice(offset, offset + imageBatchSize);
        const results = await Promise.all(batch.map(async imageId => {
          try {
            return await loadImage(imageId);
          } catch (imageError) {
            console.warn('[Individual O] Impossible de charger une image indexée pour le tri des performers :', imageId, imageError);
            await updateIndividualImageIndex(imageId, false);
            return null;
          }
        }));
        results.forEach(result => {
          if (!result || !Array.isArray(result.history)) return;
          result.history.forEach(entry => {
            (Array.isArray(entry.performer_ids) ? entry.performer_ids : []).forEach(id => {
              const key = String(id);
              counts.set(key, (counts.get(key) || 0) + 1);
            });
          });
        });
      }

      individualSortCounts = counts;
      return counts;
    })();

    try {
      return await individualSortCountsPromise;
    } catch (error) {
      individualSortCountsPromise = null;
      throw error;
    }
  }

  async function handleIndividualPerformersSort(input, init, request) {
    const requestedFilter = request.variables.filter || {};
    const page = Math.max(1, Number(requestedFilter.page) || 1);
    const perPage = Math.max(1, Number(requestedFilter.per_page) || 40);
    const direction = String(requestedFilter.direction || 'DESC').toUpperCase();
    const all = await loadAllFilteredPerformers(input, init, request);
    const counts = await getIndividualSortCounts();
    // Comme pour le tri des marqueurs, ne conserver que les performeurs
    // ayant au moins une attribution d'O individuel (scène ou image).
    const eligiblePerformers = all.performers.filter(performer =>
      (counts.get(String(performer.id)) || 0) > 0
    );
    eligiblePerformers.sort((a, b) => {
      const countA = counts.get(String(a.id)) || 0;
      const countB = counts.get(String(b.id)) || 0;
      if (countA !== countB) return direction === 'ASC' ? countA - countB : countB - countA;
      return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
    });

    const start = (page - 1) * perPage;
    const payload = JSON.parse(JSON.stringify(all.basePayload));
    if (!payload.data || !payload.data.findPerformers) throw new Error('Réponse FindPerformers invalide.');
    payload.data.findPerformers.count = eligiblePerformers.length;
    payload.data.findPerformers.performers = eligiblePerformers.slice(start, start + perPage);
    return payload;
  }

  function installIndividualSortInterceptor() {
    if (individualSortInterceptorInstalled) return;
    individualSortInterceptorInstalled = true;
    window.fetch = async function (...args) {
      const input = args[0];
      const init = args[1] || {};
      const body = init.body;
      if (typeof body === 'string') {
        try {
          const request = JSON.parse(body);
          const path = window.location.pathname;
          const isMarkerListRoute = /^\/(?:scenes\/markers|markers|tags\/\d+\/markers)(?:\/|$)/i.test(path);
          const isPerformerListRoute = /^\/performers\/?$/i.test(path);
          if (isMarkerListRoute && request.operationName === 'FindSceneMarkers' && request.variables && request.variables.filter) {
            individualMarkerSortActive = request.variables.filter.sort === 'individual_marker_o_count';
            if (individualMarkerSortActive) {
              try {
                const payload = await handleIndividualMarkersSort(input, init, request);
                return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
              } catch (error) {
                console.error('[Individual O] Échec du tri des marqueurs :', error);
                const fallback = Object.assign({}, request, { variables: Object.assign({}, request.variables, {
                  filter: Object.assign({}, request.variables.filter, { sort: 'scene_id' })
                }) });
                return nativeFetch(input, Object.assign({}, init, { body: JSON.stringify(fallback) }));
              }
            }
          }
          if (isPerformerListRoute && request.operationName === 'FindPerformers' && request.variables && request.variables.filter) {
            const sort = request.variables.filter.sort;
            individualSortActive = sort === 'individual_o_count';
            if (!individualSortActive) { individualSortButton = null; individualSortButtonContainer = null; }
            if (individualSortActive) {
              try {
                const payload = await handleIndividualPerformersSort(input, init, request);
                return new Response(JSON.stringify(payload), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('[Individual O] Échec du tri des performeurs :', error);
                const fallback = Object.assign({}, request, {
                  variables: Object.assign({}, request.variables, {
                    filter: Object.assign({}, request.variables.filter, { sort: 'name' })
                  })
                });
                return nativeFetch(input, Object.assign({}, init, { body: JSON.stringify(fallback) }));
              }
            }
          }
        } catch (error) {
          // Les autres requêtes GraphQL restent inchangées.
        }
      }
      return nativeFetch.apply(this, args);
    };
  }

  function getReactSelectHandler(element) {
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null;
    for (let i = 0; fiber && i < 7; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && typeof props.onSelect === 'function') return props.onSelect;
    }
    return null;
  }

  function syncIndividualSortLabel() {
    if (!individualSortActive) return;
    // Le bouton natif peut être recréé par React après setSortBy().
    // On conserve donc son conteneur stable (input-group-prepend), pas seulement
    // la référence du bouton qui peut devenir obsolète.
    let button = individualSortButtonContainer && individualSortButtonContainer.isConnected
      ? individualSortButtonContainer.querySelector('button.dropdown-toggle')
      : null;
    if (!button && individualSortButton && individualSortButton.isConnected) {
      button = individualSortButton;
    }
    if (!button) {
      // Le libellé peut être entièrement effacé par le rendu React.
      // Le contrôle de tri est le bouton dropdown-toggle du groupe de tri
      // (input-group-prepend) ; ne pas dépendre de son texte pour le retrouver.
      const candidates = Array.from(
        document.querySelectorAll('.input-group-prepend button.dropdown-toggle')
      );
      button = candidates.find(node => {
        const group = node.parentElement && node.parentElement.parentElement;
        return group && (
          group.querySelector('.dropdown-menu [data-value="o_counter"]') ||
          group.querySelector('.dropdown-menu [data-value="individual_o_count"]')
        );
      }) || candidates[0] || null;
    }
    if (button) {
      individualSortButton = button;
      individualSortButtonContainer = button.parentElement;
      if (button.textContent.trim() !== (ioIsFrench ? 'O individuels' : 'Individual O Count')) button.textContent = ioIsFrench ? 'O individuels' : 'Individual O Count';
    }
  }

  function installPerformerSortOption() {
    if (!/^\/performers\/?$/i.test(window.location.pathname)) {
      document.querySelectorAll('[data-value="individual_o_count"]').forEach(node => node.remove());
      return;
    }
    const nativeItem = Array.from(document.querySelectorAll('.dropdown-menu .dropdown-item'))
      .find(node => node.dataset.value === 'o_counter');
    if (!nativeItem || nativeItem.parentElement.querySelector('[data-value="individual_o_count"]')) return;
    const option = nativeItem.cloneNode(true);
    option.dataset.value = 'individual_o_count';
    option.textContent = ioIsFrench ? 'Nombre d’O individuel' : 'Individual O Count';
    option.classList.remove('bg-secondary', 'text-white');
    if (individualSortActive) option.classList.add('bg-secondary', 'text-white');
    option.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const select = getReactSelectHandler(nativeItem);
      if (select) {
        individualSortButton = Array.from(document.querySelectorAll('.input-group-prepend button.dropdown-toggle'))
          .find(node => /Nombre d'O|O individuels/.test(node.textContent || '')) || individualSortButton;
        if (individualSortButton) individualSortButtonContainer = individualSortButton.parentElement;
        individualSortActive = true;
        select('individual_o_count');
        // React peut rendre le bouton après le callback onSelect : plusieurs
        // passages courts couvrent le rendu sans ajouter d'élément à l'interface.
        window.setTimeout(syncIndividualSortLabel, 0);
        window.setTimeout(syncIndividualSortLabel, 50);
        window.setTimeout(syncIndividualSortLabel, 150);
      } else {
        console.error('[Individual O] Impossible de récupérer le gestionnaire du menu de tri natif.');
      }
    });
    nativeItem.insertAdjacentElement('afterend', option);
  }


  const individualMarkerSortCache = new Map();
  let individualMarkerSortActive = false;

  async function loadAllFilteredMarkers(input, init, request) {
    const key = JSON.stringify({
      q: request.variables.filter.q || '',
      scene_marker_filter: request.variables.scene_marker_filter || {}
    });
    const cached = individualMarkerSortCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = (async () => {
      const pageSize = 200;
      async function loadPage(page) {
        const nextRequest = Object.assign({}, request, {
          variables: Object.assign({}, request.variables, {
            filter: Object.assign({}, request.variables.filter, {
              page, per_page: pageSize, sort: 'scene_id', direction: 'ASC'
            })
          })
        });
        const response = await nativeFetch(input, Object.assign({}, init, {
          body: JSON.stringify(nextRequest)
        }));
        const payload = await response.json();
        if (!response.ok) throw new Error('Erreur HTTP lors du chargement des marqueurs.');
        if (payload.errors && payload.errors.length) throw new Error(payload.errors.map(e => e.message).join('\\n'));
        return payload;
      }
      const first = await loadPage(1);
      const result = first?.data?.findSceneMarkers;
      if (!result) throw new Error('Réponse FindSceneMarkers invalide.');
      const all = (result.scene_markers || []).slice();
      const pages = Math.ceil((Number(result.count) || 0) / pageSize);
      for (let offset = 2; offset <= pages; offset += 5) {
        const batch = [];
        for (let page = offset; page < Math.min(offset + 5, pages + 1); page++) batch.push(loadPage(page));
        const payloads = await Promise.all(batch);
        payloads.forEach(p => all.push(...(p?.data?.findSceneMarkers?.scene_markers || [])));
      }
      return { count: Number(result.count) || 0, markers: all, basePayload: first };
    })();
    individualMarkerSortCache.set(key, { promise, expiresAt: Date.now() + 60000 });
    try { return await promise; } catch (e) { individualMarkerSortCache.delete(key); throw e; }
  }

  async function handleIndividualMarkersSort(input, init, request) {
    const f = request.variables.filter || {};
    const page = Math.max(1, Number(f.page) || 1);
    const perPage = Math.max(1, Number(f.per_page) || 20);
    const direction = String(f.direction || 'DESC').toUpperCase();
    const all = await loadAllFilteredMarkers(input, init, request);
    const history = await fetchAllIndividualHistory(false);
    const counts = new Map();
    history.forEach(entry => {
      if (!entry.marker_id) return;
      const id = String(entry.marker_id);
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    // En mode O individuels, exclure les marqueurs sans aucune entrée associée.
    const eligibleMarkers = all.markers.filter(marker => (counts.get(String(marker.id)) || 0) >= 1);
    eligibleMarkers.sort((a, b) => {
      const ca = counts.get(String(a.id)) || 0;
      const cb = counts.get(String(b.id)) || 0;
      if (ca !== cb) return direction === 'ASC' ? ca - cb : cb - ca;
      return String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' });
    });
    const payload = JSON.parse(JSON.stringify(all.basePayload));
    payload.data.findSceneMarkers.count = eligibleMarkers.length;
    payload.data.findSceneMarkers.scene_markers = eligibleMarkers.slice((page - 1) * perPage, page * perPage);
    return payload;
  }

  function installMarkerSortOption() {
    if (!/^\/(?:scenes\/markers|markers|tags\/\d+\/markers)(?:\/|$)/i.test(window.location.pathname)) {
      document.querySelectorAll('[data-value="individual_marker_o_count"]').forEach(node => node.remove());
      return;
    }
    const nativeItem = Array.from(document.querySelectorAll('.dropdown-menu .dropdown-item'))
      .find(node => node.dataset.value === 'scene_id');
    if (!nativeItem || nativeItem.parentElement.querySelector('[data-value="individual_marker_o_count"]')) return;
    const option = nativeItem.cloneNode(true);
    option.dataset.value = 'individual_marker_o_count';
    option.textContent = ioIsFrench ? 'Nombre d’O individuel' : 'Individual O Count';
    option.classList.remove('bg-secondary', 'text-white');
    if (individualMarkerSortActive) option.classList.add('bg-secondary', 'text-white');
    option.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const select = getReactSelectHandler(nativeItem);
      if (!select) return;
      individualMarkerSortActive = true;
      select('individual_marker_o_count');
      const update = () => {
        const button = nativeItem.closest('.dropdown')?.querySelector('button.dropdown-toggle')
          || document.querySelector('.input-group-prepend button.dropdown-toggle');
        if (button) button.textContent = 'O individuels';
      };
      window.setTimeout(update, 0);
      window.setTimeout(update, 50);
      window.setTimeout(update, 150);
    });
    nativeItem.insertAdjacentElement('afterend', option);
  }

  const escapeHTML = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function currentSceneId() {
    const match = window.location.pathname.match(/\/scenes\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  }

  function getStashVideoPlayer() {
    // Stash v0.31.1 uses Video.js with the stable player id "VideoJsPlayer".
    // Video.js attaches its Player instance to both the wrapper and tech element.
    const host = document.getElementById('VideoJsPlayer') || document.querySelector('.video-js');
    const player = (host && host.player) || (host && host.querySelector('video') && host.querySelector('video').player);
    if (player && typeof player.currentTime === 'function' && !(typeof player.isDisposed === 'function' && player.isDisposed())) {
      return player;
    }
    return null;
  }

  function currentPlaybackTime() {
    // Read the same clock as Stash's Video.js player, not the raw HTML media element.
    const player = getStashVideoPlayer();
    if (player) {
      const time = Number(player.currentTime());
      if (Number.isFinite(time)) return Math.max(0, time);
    }
    // Fallback for non-standard/external player layouts.
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(node => {
      const rect = node.getBoundingClientRect();
      return node.readyState > 0 && rect.width > 0 && rect.height > 0;
    }) || videos.find(node => node.readyState > 0);
    if (!video || !Number.isFinite(video.currentTime)) return null;
    return Math.max(0, video.currentTime);
  }

  function formatTimestamp(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '';
    const total = Math.floor(Math.max(0, Number(seconds)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = value => String(value).padStart(2, '0');
    return hours > 0 ? pad(hours) + ':' + pad(minutes) + ':' + pad(secs) : pad(minutes) + ':' + pad(secs);
  }

  function parseTimestamp(value) {
    if (!value || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim())) return null;
    const parts = value.trim().split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part)) || parts[parts.length - 1] > 59 || parts[parts.length - 2] > 59) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  function seekToTimestamp(seconds) {
    const target = Number(seconds);
    if (!Number.isFinite(target) || target < 0) return;
    const player = getStashVideoPlayer();
    if (player) {
      try {
        // Use Video.js' API so its timeline, marker overlay and playback state stay in sync.
        // Video.js also queues the seek if the media tech is not ready yet.
        player.currentTime(target);
        return;
      } catch (error) {
        console.warn('[Individual O] Video.js seek failed; trying native fallback.', error);
      }
    }
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(node => {
      const rect = node.getBoundingClientRect();
      return node.readyState > 0 && rect.width > 0 && rect.height > 0;
    }) || videos.find(node => node.readyState > 0);
    if (!video) {
      window.alert('Lecteur vidéo introuvable sur cette page.');
      return;
    }
    try { video.currentTime = target; }
    catch (error) { window.alert('Impossible de repositionner la vidéo : ' + error.message); }
  }

  function currentImageId() {
    const match = window.location.pathname.match(/\/images\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  }

  function currentPerformerId() {
    const match = window.location.pathname.match(/\/performers\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
    }
    return root;
  }

  // Keep the full-width launcher only inside the plugin's dedicated sidebar tab.
  function placeLauncher(root) {
    const panel = document.querySelector('.scene-tabs');
    if (!panel) return false;
    const activeLink = panel.querySelector('.nav-link.active, .nav-item.active .nav-link');
    const isIndividualTab = activeLink && activeLink.textContent.trim().toLocaleLowerCase() === 'o individuel';
    const pane = panel.querySelector('#individual-o-scene-sidebar-history');
    if (!isIndividualTab || !pane) {
      root.remove();
      return false;
    }
    if (root.parentElement !== pane) pane.insertBefore(root, pane.firstChild);
    return true;
  }

  function ensureSceneHeaderLauncher(sceneId) {
    const toolbar = document.querySelector('.scene-toolbar');
    const existing = document.getElementById('individual-o-header-launcher');
    if (!toolbar) {
      if (existing) existing.remove();
      return;
    }

    // Keep the launcher as a direct child of the toolbar. This makes the
    // operation idempotent with the document-wide MutationObserver: inserting
    // it inside the dropdown would trigger repeated remove/insert cycles.
    if (existing && existing.dataset.sceneId === String(sceneId) && existing.parentElement === toolbar) return;
    if (existing) existing.remove();

    const overflowButton = toolbar.querySelector('button.dropdown-toggle');
    const overflowGroup = overflowButton && (
      overflowButton.closest('.scene-toolbar-group') || overflowButton.closest('.dropdown')
    );

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'individual-o-header-launcher';
    button.className = 'individual-o-header-launcher minimal btn btn-secondary';
    button.dataset.sceneId = String(sceneId);
    button.innerHTML = individualOIconHTML('individual-o-launcher-icon');
    button.title = 'Enregistrer un O individuel';
    button.setAttribute('aria-label', 'Enregistrer un O individuel');
    button.addEventListener('click', () => openManager(sceneId));

    if (overflowGroup && overflowGroup.parentElement === toolbar) {
      toolbar.insertBefore(button, overflowGroup);
    } else {
      // Safe fallback: append to the toolbar, never inside a React-owned menu.
      toolbar.appendChild(button);
    }
  }

  function removeRoot() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
  }

  function removeMarkerCounterBadges() {
    document.querySelectorAll('.individual-o-marker-count').forEach(node => node.remove());
  }

  function parseDisplayedMarkerTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/);
    return match ? parseTimestamp(match[1]) : null;
  }

  function getMediaURL(node) {
    if (!node) return '';
    const candidates = [node.currentSrc, node.src, node.getAttribute && node.getAttribute('src')];
    if (node.querySelectorAll) {
      node.querySelectorAll('source[src]').forEach(source => candidates.push(source.src, source.getAttribute('src')));
    }
    return candidates.find(value => typeof value === 'string' && value.includes('/scene/')) || '';
  }

  function markerIdFromPreviewURL(value) {
    if (!value) return null;
    // Stash marker preview streams use /scene/{sceneId}/scene_marker/{markerId}/stream.
    const match = String(value).match(/\/scene\/(\d+)\/scene_marker\/(\d+)\/(?:stream|preview|screenshot)(?:[/?#]|$)/i);
    return match ? { sceneId: match[1], markerId: match[2] } : null;
  }

  function scanMarkerPreviewCounters(scene, counts, showCounters) {
    if (!scene || !Array.isArray(scene.scene_markers)) return;
    if (!showCounters) {
      document.querySelectorAll('.individual-o-marker-preview-host').forEach(host => {
        if (host.dataset.individualOMarkerSceneId !== String(scene.id)) return;
        host.querySelector(':scope > .individual-o-marker-preview-count')?.remove();
        host.classList.remove('individual-o-marker-preview-host');
        delete host.dataset.individualOMarkerSceneId;
      });
      return;
    }
    const markersById = new Map(scene.scene_markers.map(marker => [String(marker.id), marker]));
    const sceneKey = String(scene.id);
    const desiredHosts = new Set();
    const mediaNodes = Array.from(document.querySelectorAll('video, img'));

    mediaNodes.forEach(media => {
      const match = markerIdFromPreviewURL(getMediaURL(media));
      if (!match || String(match.sceneId) !== sceneKey) return;
      const marker = markersById.get(String(match.markerId));
      if (!marker || String(marker.title || '').trim().toLocaleLowerCase() !== newMarkerTitle.toLocaleLowerCase()) return;

      const host = media.closest('.wall-item, .marker-card, .scene-marker-card, .scene-marker-preview, .marker-preview, [class*="marker-card"]') || media.parentElement;
      if (!host) return;
      desiredHosts.add(host);
      host.classList.add('individual-o-marker-preview-host');
      host.dataset.individualOMarkerSceneId = sceneKey;

      const count = counts.get(String(marker.id)) || 0;
      let badge = host.querySelector(':scope > .individual-o-marker-preview-count');
      if (!count) {
        if (badge) badge.remove();
        if (!host.querySelector(':scope > .individual-o-marker-preview-count')) {
          host.classList.remove('individual-o-marker-preview-host');
          delete host.dataset.individualOMarkerSceneId;
        }
        return;
      }

      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'individual-o-marker-preview-count';
        host.appendChild(badge);
      }
      const label = String(count);
      if (badge.querySelector('strong')?.textContent !== label) badge.innerHTML = individualOIconHTML() + '<strong>' + label + '</strong>';
      badge.title = count + ' attribution(s) O individuel associée(s) à ce marqueur';
      badge.setAttribute('aria-label', badge.title);
    });

    // Clean only this scene's hosts. This allows multiple scenes to be scanned
    // together on Stash's global Markers page without removing one another's badges.
    document.querySelectorAll('.individual-o-marker-preview-host').forEach(host => {
      if (host.dataset.individualOMarkerSceneId !== sceneKey || desiredHosts.has(host)) return;
      const badge = host.querySelector(':scope > .individual-o-marker-preview-count');
      if (badge) badge.remove();
      host.classList.remove('individual-o-marker-preview-host');
      delete host.dataset.individualOMarkerSceneId;
    });
  }

  async function getCachedSceneMarkerCounts(sceneId, force) {
    let cached = markerCounterCache.get(String(sceneId));
    if (force || !cached || cached.expiresAt <= Date.now()) {
      const promise = loadScene(sceneId).then(({ scene, history }) => {
        const counts = new Map();
        history.forEach(entry => {
          if (!entry.marker_id) return;
          const markerId = String(entry.marker_id);
          // Un historique représente un O, quel que soit le nombre de performeurs associés.
          counts.set(markerId, (counts.get(markerId) || 0) + 1);
        });
        return { scene, counts };      });
      cached = { promise, expiresAt: Date.now() + 15000 };
      markerCounterCache.set(String(sceneId), cached);
    }
    return cached.promise;
  }


  async function scanSceneMarkerCounters(sceneId, force) {
    try {
      await loadMarkerSettings();
      const { scene, counts } = await getCachedSceneMarkerCounts(sceneId, force);
      if (currentSceneId() !== String(sceneId)) return;

      const showCounters = await areHistoryMarkerCountersVisible();
      // Preview badge is placed on the marker card thumbnail, never on the player timeline.
      scanMarkerPreviewCounters(scene, counts, showCounters);

      // Counter beside the marker title in the left marker panel.
      const panel = document.querySelector('.scene-markers-panel');
      if (!panel) return;
      const rows = Array.from(panel.querySelectorAll('.primary-card-body > div')).filter(row => row.querySelector('.row'));
      if (!showCounters) {
        panel.querySelectorAll('.individual-o-marker-count').forEach(node => node.remove());
        return;
      }
      rows.forEach(row => {
        const existingBadge = row.querySelector('.individual-o-marker-count');
        const titleButton = Array.from(row.querySelectorAll('.row button')).find(button =>
          String(button.textContent || '').trim().toLocaleLowerCase() === newMarkerTitle.toLocaleLowerCase()
        );
        if (!titleButton) {
          if (existingBadge) existingBadge.remove();
          return;
        }
        const timeNode = row.querySelector('.d-flex > div');
        const displayedTime = timeNode ? parseDisplayedMarkerTime(timeNode.textContent) : null;
        const marker = (scene.scene_markers || []).find(item => {
          if (String(item.title || '').trim().toLocaleLowerCase() !== newMarkerTitle.toLocaleLowerCase()) return false;
          return displayedTime == null || Math.abs(Number(item.seconds) - displayedTime) < 1;
        });
        const count = marker ? (counts.get(String(marker.id)) || 0) : 0;
        if (!count) {
          if (existingBadge) existingBadge.remove();
          return;
        }
        const label = String(count);
        if (existingBadge) {
          if (existingBadge.querySelector('strong')?.textContent !== label) existingBadge.innerHTML = individualOIconHTML() + '<strong>' + label + '</strong>';
          existingBadge.title = count + ' attribution(s) O individuel associée(s) à ce marqueur';
          return;
        }
        const badge = document.createElement('span');
        badge.className = 'individual-o-marker-count';
        badge.innerHTML = individualOIconHTML() + '<strong>' + label + '</strong>';
        badge.title = count + ' attribution(s) O individuel associée(s) à ce marqueur';
        const editButton = Array.from(row.querySelectorAll('.row button')).find(button => button !== titleButton);
        (editButton || titleButton).insertAdjacentElement('afterend', badge);
      });
    } catch (error) {
      console.error('[Individual O] Impossible de compter les O associés aux marqueurs.', error);
    }
  }

  async function scanGlobalMarkerCounters(force) {
    // The global /markers page contains previews from multiple scenes. Their
    // preview URLs carry both the scene ID and marker ID, so scan only scenes
    // represented in the currently rendered grid/list.
    const sceneIds = new Set();
    document.querySelectorAll('video, img').forEach(media => {
      const match = markerIdFromPreviewURL(getMediaURL(media));
      if (match) sceneIds.add(String(match.sceneId));
    });

    if (!sceneIds.size) {
      // Do not leave stale badges when switching to a marker view with no
      // generated preview currently rendered.
      document.querySelectorAll('.individual-o-marker-preview-host').forEach(host => {
        host.querySelector(':scope > .individual-o-marker-preview-count')?.remove();
        host.classList.remove('individual-o-marker-preview-host');
        delete host.dataset.individualOMarkerSceneId;
      });
      return;
    }

    await loadMarkerSettings();
    const showCounters = await areHistoryMarkerCountersVisible();
    await Promise.all(Array.from(sceneIds).map(async sceneId => {
      try {
        const { scene, counts } = await getCachedSceneMarkerCounts(sceneId, !!force);
        scanMarkerPreviewCounters(scene, counts, showCounters);
      } catch (error) {
        console.error('[Individual O] Impossible de charger les compteurs des marqueurs de la scène ' + sceneId, error);
      }
    }));
  }

  function scheduleMarkerCounterScan(force) {
    if (markerCounterScanQueued) return;
    markerCounterScanQueued = true;
    Promise.resolve().then(() => {
      markerCounterScanQueued = false;
      const sceneId = currentSceneId();
      const isGlobalMarkersPage = /^\/(?:scenes\/markers|markers|tags\/\d+\/markers)(?:\/|$)/i.test(window.location.pathname);
      if (sceneId) {
        scanSceneMarkerCounters(sceneId, !!force);
      } else if (isGlobalMarkersPage) {
        scanGlobalMarkerCounters(!!force);
      } else {
        removeMarkerCounterBadges();
        document.querySelectorAll('.individual-o-timeline-count, .individual-o-marker-preview-count').forEach(node => node.remove());
        document.querySelectorAll('.individual-o-marker-preview-host').forEach(node => {
          node.classList.remove('individual-o-marker-preview-host');
          delete node.dataset.individualOMarkerSceneId;
        });
      }
    });
  }

  function scheduleScan() {
    registerGlobalHistoryRoute();
    registerIndividualOSceneTabPatch();

    installGlobalHistoryLauncher();
    installPerformerSortOption();
    installMarkerSortOption();
    syncIndividualSortLabel();
    if (scanQueued) return;
    scanQueued = true;
    Promise.resolve().then(() => {
      scanQueued = false;
      scanPerformerCards();
      areClassicPerformerCountersVisible().then(applyClassicPerformerCounterVisibility);
      scheduleMarkerCounterScan(false);
      const sceneId = currentSceneId();
      const imageId = currentImageId();
      const performerId = currentPerformerId();
      if (sceneId) {
        lastPerformerId = null;
        removePerformerCounter();
        renderSceneSidebarIndividualHistory(sceneId, false);
        ensureSceneHeaderLauncher(sceneId);
        const existingRoot = document.getElementById(ROOT_ID);
        if (sceneId === lastSceneId && existingRoot) {
          placeLauncher(existingRoot);
          return;
        }
        lastSceneId = sceneId;
        renderLauncher(sceneId);
        return;
      }
      lastSceneId = null;
      removeRoot();
      const headerLauncher = document.getElementById('individual-o-header-launcher');
      if (headerLauncher) headerLauncher.remove();
      if (imageId) {
        lastPerformerId = null; removePerformerCounter();
        ensureImageIndividualOTab();
        renderImageSidebarIndividualHistory(imageId, false);
        ensureImageHeaderLauncher(imageId);
        return;
      }
      const imageLauncher = document.getElementById('individual-o-image-header-launcher');
      if (imageLauncher) imageLauncher.remove();
      if (performerId) {
        if (performerId === lastPerformerId && document.getElementById('individual-o-performer-counter')) return;
        lastPerformerId = performerId;
        renderPerformerCounter(performerId);
      } else {
        lastPerformerId = null;
        removePerformerCounter();
      }
    });
  }



  let sidebarSceneHistoryRequest = null;

  function findNativeSceneOHistory() {
    return document.querySelector('.o-history');
  }

  function updateNativeSceneApolloCache(sceneId, mutationResult) {
    const client = window.__individualOApolloClient;
    if (!client || !client.cache || !mutationResult) return false;

    try {
      const cacheId = client.cache.identify({ __typename: 'Scene', id: String(sceneId) });
      if (!cacheId) return false;

      // Stash v0.31.1 stores the scene toolbar counter and native O history
      // on the normalized Scene object. Updating these fields broadcasts the
      // change to the existing ScenePage query without reloading the page.
      client.cache.modify({
        id: cacheId,
        fields: {
          o_counter() {
            return Number(mutationResult.count) || 0;
          },
          o_history() {
            return Array.isArray(mutationResult.history) ? mutationResult.history : [];
          }
        }
      });
      return true;
    } catch (error) {
      console.warn('[Individual O] Impossible de mettre à jour le cache Apollo natif :', error);
      return false;
    }
  }

  function updateNativeImageApolloCache(imageId, newCount) {
    const client = window.__individualOApolloClient;
    if (!client || !client.cache || newCount == null) return false;
    try {
      const cacheId = client.cache.identify({ __typename: 'Image', id: String(imageId) });
      if (!cacheId) return false;
      client.cache.modify({
        id: cacheId,
        fields: {
          o_counter() {
            return Number(newCount) || 0;
          }
        }
      });
      return true;
    } catch (error) {
      console.warn('[Individual O] Impossible de mettre à jour le cache Apollo natif de l’image :', error);
      return false;
    }
  }

  function updateNativePerformerApolloCache(performerIds) {
    const client = window.__individualOApolloClient;
    if (!client || !client.cache) return false;
    let updated = false;
    try {
      (performerIds || []).forEach(performerId => {
        const cacheId = client.cache.identify({ __typename: 'Performer', id: String(performerId) });
        if (!cacheId) return;
        const result = client.cache.modify({
          id: cacheId,
          fields: {
            o_counter(existing = 0) {
              return (Number(existing) || 0) + 1;
            }
          }
        });
        if (result) updated = true;
      });
      return updated;
    } catch (error) {
      console.warn('[Individual O] Impossible de mettre à jour les compteurs natifs des performeurs :', error);
      return false;
    }
  }

  function registerIndividualOSceneTabPatch() {
    const api = window.PluginApi;
    if (!api || !api.React || !api.patch || !api.libraries || !api.libraries.Bootstrap || !api.libraries.Apollo) return false;
    const React = api.React;
    const Apollo = api.libraries.Apollo;
    const useApolloClient = Apollo && Apollo.useApolloClient;
    // The bridge is optional: if a Stash build does not expose this hook,
    // keep the plugin's tab and all existing functionality intact.
    const IndividualOApolloBridge = typeof useApolloClient === 'function'
      ? function IndividualOApolloBridge() {
          const client = useApolloClient();
          React.useEffect(() => {
            window.__individualOApolloClient = client;
            window.__individualOApolloBridgeReady = true;
            return () => {
              if (window.__individualOApolloClient === client) {
                delete window.__individualOApolloClient;
                delete window.__individualOApolloBridgeReady;
              }
            };
          }, [client]);
          return null;
        }
      : function IndividualOApolloBridgeUnavailable() { return null; };

    const Bootstrap = api.libraries.Bootstrap;
    const Nav = Bootstrap.Nav;
    const Tab = Bootstrap.Tab;
    if (!Nav || !Nav.Item || !Nav.Link || !Tab || !Tab.Pane) return false;

    // PatchContainerComponent receives its children as props. Use `before`
    // to extend that children list, leaving Stash's own React tree intact.
    if (!window.__individualOSceneTabPatchRegisteredV2) {
      api.patch.before('ScenePage.Tabs', (props) => {
        const children = React.Children.toArray(props.children);
        if (children.some(child => child && child.key === 'individual-o-scene-tab')) return [props];
        const tabItem = React.createElement(
          Nav.Item,
          { key: 'individual-o-scene-tab' },
          React.createElement(
            Nav.Link,
            { eventKey: 'individual-o-history-panel' },
            'O individuel'
          )
        );
        return [Object.assign({}, props, { children: children.concat(tabItem) })];
      });

      api.patch.before('ScenePage.TabContent', (props) => {
        const children = React.Children.toArray(props.children);
        if (children.some(child => child && child.key === 'individual-o-scene-tab-pane')) return [props];
        const pane = React.createElement(
          Tab.Pane,
          { eventKey: 'individual-o-history-panel', key: 'individual-o-scene-tab-pane' },
          React.createElement(React.Fragment, null,
            React.createElement(IndividualOApolloBridge),
            React.createElement('div', {
              id: 'individual-o-scene-sidebar-history',
              className: 'individual-o-scene-sidebar-history'
            })
          )
        );
        return [Object.assign({}, props, { children: children.concat(pane) })];
      });
      window.__individualOSceneTabPatchRegisteredV2 = true;
    }

    // Stash v0.31.1 exposes ImageDetailPanel as a patchable component.
    // Mount the Apollo bridge there (not DetailImage, which is not the image
    // detail panel extension point) while preserving the original panel.
    if (!window.__individualOImageApolloBridgeRegisteredV3) {
      api.patch.after('ImageDetailPanel', (...patchArgs) => {
        // patch.after receives every original render argument followed by the
        // rendered React node. ImageDetailPanel has more than one render arg;
        // never assume the rendered node is the second argument.
        const rendered = patchArgs[patchArgs.length - 1];
        if (!React.isValidElement(rendered) && rendered != null && typeof rendered !== 'string' && typeof rendered !== 'number' && !Array.isArray(rendered)) {
          console.warn('[Individual O] ImageDetailPanel patch: unexpected render result; Apollo bridge not mounted.', rendered);
          return null;
        }
        return React.createElement(
          React.Fragment,
          null,
          rendered,
          React.createElement(IndividualOApolloBridge, { key: 'individual-o-image-apollo-bridge' })
        );
      });
      window.__individualOImageApolloBridgeRegisteredV3 = true;
    }
    return true;
  }

  let imageSidebarHistoryRequest = null;

  function ensureImageIndividualOTab() {
    const imageTabs = document.querySelector('.image-tabs');
    const nav = imageTabs && imageTabs.querySelector('.nav-tabs');
    const tabContent = imageTabs && imageTabs.querySelector('.tab-content');
    if (!nav || !tabContent) return false;

    let item = nav.querySelector('[data-individual-o-image-tab]');
    let pane = tabContent.querySelector('#individual-o-image-sidebar-history-pane');
    if (!item) {
      item = document.createElement('li');
      item.className = 'nav-item';
      item.setAttribute('data-individual-o-image-tab', 'true');
      const link = document.createElement('a');
      link.className = 'nav-link';
      link.href = '#individual-o-image-sidebar-history-pane';
      link.textContent = 'O individuel';
      link.setAttribute('role', 'tab');
      link.setAttribute('aria-controls', 'individual-o-image-sidebar-history-pane');
      link.addEventListener('click', event => {
        event.preventDefault();
        activateImageIndividualOTab(true);
      });
      item.appendChild(link);
      nav.appendChild(item);
    }
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'individual-o-image-sidebar-history-pane';
      pane.className = 'tab-pane';
      pane.setAttribute('role', 'tabpanel');
      pane.innerHTML = '<div id="individual-o-image-sidebar-history" class="individual-o-scene-sidebar-history"></div>';
      tabContent.appendChild(pane);
    }
    if (!nav.dataset.individualOImageTabBound) {
      nav.addEventListener('click', event => {
        const nativeLink = event.target.closest('a.nav-link');
        if (!nativeLink || nativeLink.closest('[data-individual-o-image-tab]')) return;

        // Stash/React-Bootstrap may keep the same selected tab in React state
        // after our custom tab temporarily changes DOM classes. In that case,
        // clicking the already-selected native tab does not trigger a React
        // render, leaving every native pane hidden. Restore the clicked pane
        // after Stash has processed the click.
        window.setTimeout(() => {
          const href = nativeLink.getAttribute('href') || nativeLink.getAttribute('data-target') || nativeLink.getAttribute('data-bs-target') || '';
          const controlledId = nativeLink.getAttribute('aria-controls') || '';
          const targetId = controlledId || (href.startsWith('#') ? decodeURIComponent(href.slice(1)) : '');
          let targetPane = targetId ? document.getElementById(targetId) : null;
          const pluginPane = document.getElementById('individual-o-image-sidebar-history-pane');
          const pluginItem = nav.querySelector('[data-individual-o-image-tab]');

          // Some Stash image tabs do not expose href/aria-controls. In that
          // case, pair the clicked native tab with the native tab-pane at the
          // same position, excluding our injected tab and pane.
          if (!targetPane || !targetPane.classList.contains('tab-pane')) {
            const nativeLinks = Array.from(nav.querySelectorAll('.nav-link')).filter(link => !link.closest('[data-individual-o-image-tab]'));
            const nativePanes = Array.from(tabContent.querySelectorAll('.tab-pane')).filter(node => node !== pluginPane);
            const index = nativeLinks.indexOf(nativeLink);
            targetPane = index >= 0 ? nativePanes[index] : null;
          }

          if (pluginPane) pluginPane.classList.remove('active', 'show');
          if (pluginItem) {
            pluginItem.classList.remove('active');
            const pluginLink = pluginItem.querySelector('.nav-link');
            if (pluginLink) {
              pluginLink.classList.remove('active');
              pluginLink.setAttribute('aria-selected', 'false');
            }
          }
          if (!targetPane || !targetPane.classList.contains('tab-pane')) return;
          tabContent.querySelectorAll('.tab-pane').forEach(node => node.classList.remove('active', 'show'));
          targetPane.classList.add('active', 'show');
          nav.querySelectorAll('.nav-item').forEach(node => node.classList.remove('active'));
          nav.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            link.setAttribute('aria-selected', 'false');
          });
          nativeLink.classList.add('active');
          nativeLink.setAttribute('aria-selected', 'true');
          const nativeItem = nativeLink.closest('.nav-item');
          if (nativeItem) nativeItem.classList.add('active');
        }, 0);
      });
      nav.dataset.individualOImageTabBound = 'true';
    }
    return true;
  }

  function activateImageIndividualOTab(activate) {
    const imageTabs = document.querySelector('.image-tabs');
    const nav = imageTabs && imageTabs.querySelector('.nav-tabs');
    const tabContent = imageTabs && imageTabs.querySelector('.tab-content');
    const item = nav && nav.querySelector('[data-individual-o-image-tab]');
    const pane = tabContent && tabContent.querySelector('#individual-o-image-sidebar-history-pane');
    if (!nav || !tabContent || !item || !pane) return;
    if (activate) {
      nav.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        link.setAttribute('aria-selected', 'false');
      });
      nav.querySelectorAll('.nav-item').forEach(node => node.classList.remove('active'));
      tabContent.querySelectorAll('.tab-pane').forEach(node => node.classList.remove('active', 'show'));
      item.classList.add('active');
      const link = item.querySelector('.nav-link');
      if (link) { link.classList.add('active'); link.setAttribute('aria-selected', 'true'); }
      pane.classList.add('active', 'show');
    } else {
      pane.classList.remove('active', 'show');
      item.classList.remove('active');
      const link = item.querySelector('.nav-link');
      if (link) { link.classList.remove('active'); link.setAttribute('aria-selected', 'false'); }
    }
  }

  async function renderImageSidebarIndividualHistory(imageId, force) {
    const existing = document.getElementById('individual-o-image-sidebar-history');
    if (existing && existing.dataset.imageId === String(imageId) && !force) return;
    if (imageSidebarHistoryRequest && imageSidebarHistoryRequest.imageId === String(imageId)) return imageSidebarHistoryRequest.promise;
    const promise = (async () => {
      try {
        const { image, history } = await loadImage(imageId);
        const showActions = await areSidebarActionsVisible();
        const showCounters = await areHistoryMarkerCountersVisible();
        if (currentImageId() !== String(imageId)) return;
        const panel = document.getElementById('individual-o-image-sidebar-history');
        if (!panel) return;
        panel.dataset.imageId = String(imageId);
        const names = Object.fromEntries((image.performers || []).map(person => [String(person.id), person.name]));
        const sorted = history.slice().sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        panel.innerHTML = '<div class="individual-o-scene-sidebar-history-launcher"><button type="button" class="individual-o-launcher"><span class="individual-o-symbol">O</span><span>Enregistrer un O individuel</span></button></div>' +
          '<div class="individual-o-scene-sidebar-heading">Historique d’O individuel ' + (showCounters ? '<span class="individual-o-inline-count">' + individualOIconHTML() + '<strong>' + sorted.length + '</strong></span>' : '') + '</div>' +
          (sorted.length ? '<ul class="individual-o-scene-sidebar-list">' + sorted.map(entry => {
            const assigned = (entry.performer_ids || []).map(id => names[String(id)] || ('Performeur #' + id)).join(', ');
            const actions = showActions ? '<div class="individual-o-scene-sidebar-actions"><button type="button" class="individual-o-sidebar-action" data-image-sidebar-edit-entry="' + escapeHTML(entry.id) + '" title="Modifier cet O individuel" aria-label="Modifier cet O individuel">Modifier</button>' +
              '<button type="button" class="individual-o-sidebar-action is-danger" data-image-sidebar-delete-entry="' + escapeHTML(entry.id) + '" title="Supprimer cet O individuel" aria-label="Supprimer cet O individuel">Supprimer</button></div>' : '';
            return '<li class="individual-o-scene-sidebar-row"><img class="individual-o-sidebar-marker-thumb" src="/image/' + encodeURIComponent(imageId) + '/thumbnail" alt=""><div class="individual-o-scene-sidebar-entry"><div class="individual-o-scene-sidebar-date">' + escapeHTML(formatDate(entry.date)) + '</div>' + (assigned ? '<div class="individual-o-scene-sidebar-performers">' + escapeHTML(assigned) + '</div>' : '') + actions + '</div></li>';
          }).join('') + '</ul>' : '<div class="individual-o-scene-sidebar-empty">Aucun O individuel enregistré.</div>');
        const launch = panel.querySelector('.individual-o-launcher');
        if (launch) launch.addEventListener('click', () => openImageManager(imageId));
        panel.querySelectorAll('[data-image-sidebar-edit-entry]').forEach(button => {
          button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const entryId = button.dataset.imageSidebarEditEntry;
            await openImageManager(imageId);
            const managerButton = document.querySelector('#individual-o-modal-backdrop .individual-o-history [data-image-edit=\"' + CSS.escape(entryId) + '\"]');
            if (managerButton) managerButton.click();
          });
        });
        panel.querySelectorAll('[data-image-sidebar-delete-entry]').forEach(button => {
          button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const entryId = button.dataset.imageSidebarDeleteEntry;
            await openImageManager(imageId);
            const managerButton = document.querySelector('#individual-o-modal-backdrop .individual-o-history [data-image-delete=\"' + CSS.escape(entryId) + '\"]');
            if (managerButton) managerButton.click();
          });
        });
      } catch (error) { console.error('[Individual O] Erreur historique latéral image', error); }
    })();
    imageSidebarHistoryRequest = { imageId: String(imageId), promise };
    try { await promise; } finally { if (imageSidebarHistoryRequest && imageSidebarHistoryRequest.promise === promise) imageSidebarHistoryRequest = null; }
  }

  async function renderSceneSidebarIndividualHistory(sceneId, force) {
    const nativePanel = findNativeSceneOHistory();
    if (!nativePanel || !nativePanel.parentElement) return;

    const existing = document.getElementById('individual-o-scene-sidebar-history');
    if (existing && existing.dataset.sceneId === String(sceneId) && !force) return;
    if (sidebarSceneHistoryRequest && sidebarSceneHistoryRequest.sceneId === String(sceneId)) {
      return sidebarSceneHistoryRequest.promise;
    }

    const promise = (async () => {
      try {
        const { scene, history } = await loadScene(sceneId);
        const showActions = await areSidebarActionsVisible();
        const showCounters = await areHistoryMarkerCountersVisible();
        if (currentSceneId() !== String(sceneId)) return;
        const latestPanel = document.getElementById('individual-o-scene-sidebar-history');
        // The panel is rendered by ScenePage.TabContent inside Stash's native
        // tab container. Never move it in the DOM: React owns this subtree.
        if (!latestPanel) return;
        const panel = latestPanel;
        panel.dataset.sceneId = String(sceneId);

        const names = Object.fromEntries((scene.performers || []).map(p => [String(p.id), p.name]));
        const sorted = (history || []).slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        panel.innerHTML =
          '<div class="individual-o-scene-sidebar-heading">Historique d’O individuel ' + (showCounters ? '<span class="individual-o-inline-count">' + individualOIconHTML() + '<strong>' + sorted.length + '</strong></span>' : '') + '</div>' +
          (sorted.length
            ? '<ul class="individual-o-scene-sidebar-list">' + sorted.map(entry => {
                const performers = (entry.performer_ids || []).map(id => names[String(id)] || ('Interprète #' + id)).join(', ');
                const timestamp = entry.timestamp == null ? '' :
                  '<button type="button" class="individual-o-scene-sidebar-timestamp" data-individual-o-seek="' + escapeHTML(entry.timestamp) + '" title="Repositionner la vidéo à ' + escapeHTML(formatTimestamp(entry.timestamp)) + '">▶ ' + escapeHTML(formatTimestamp(entry.timestamp)) + '</button>';
                const thumb = markerThumbnailHTML(Object.assign({ scene_id: sceneId }, entry), 'individual-o-sidebar-marker-thumb');
                return '<li class="individual-o-scene-sidebar-row">' + thumb + '<div class="individual-o-scene-sidebar-entry"><div class="individual-o-scene-sidebar-date">' + escapeHTML(formatDate(entry.date)) + '</div>' +
                  timestamp + (performers ? '<div class="individual-o-scene-sidebar-performers">' + escapeHTML(performers) + '</div>' : '') +
                  (showActions ? '<div class="individual-o-scene-sidebar-actions"><button type="button" class="individual-o-sidebar-action" data-sidebar-edit-entry="' + escapeHTML(entry.id) + '" title="Modifier cet O individuel" aria-label="Modifier cet O individuel">Modifier</button>' +
                  '<button type="button" class="individual-o-sidebar-action is-danger" data-sidebar-delete-entry="' + escapeHTML(entry.id) + '" title="Supprimer cet O individuel" aria-label="Supprimer cet O individuel">Supprimer</button></div>' : '') + '</div></li>';
              }).join('') + '</ul>'
            : '<div class="individual-o-scene-sidebar-empty">Aucun O individuel enregistré.</div>');

        panel.querySelectorAll('[data-individual-o-seek]').forEach(button => {
          button.addEventListener('click', () => seekToTimestamp(Number(button.dataset.individualOSeek)));
        });
        panel.querySelectorAll('[data-individual-o-marker-seek]').forEach(button => {
          button.addEventListener('click', () => seekToTimestamp(Number(button.dataset.individualOMarkerSeek)));
        });
        panel.querySelectorAll('[data-sidebar-edit-entry]').forEach(button => {
          button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const entryId = button.dataset.sidebarEditEntry;
            await openManager(sceneId);
            const managerButton = document.querySelector('#individual-o-modal-backdrop .individual-o-history [data-edit-entry="' + CSS.escape(entryId) + '"]');
            if (managerButton) managerButton.click();
          });
        });
        panel.querySelectorAll('[data-sidebar-delete-entry]').forEach(button => {
          button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const entryId = button.dataset.sidebarDeleteEntry;
            await openManager(sceneId);
            const managerButton = document.querySelector('#individual-o-modal-backdrop .individual-o-history [data-delete-entry="' + CSS.escape(entryId) + '"]');
            if (managerButton) managerButton.click();
          });
        });
      } catch (error) {
        console.error('[Individual O] Erreur historique latéral de scène', error);
      }
    })();

    sidebarSceneHistoryRequest = { sceneId: String(sceneId), promise };
    try {
      await promise;
    } finally {
      if (sidebarSceneHistoryRequest && sidebarSceneHistoryRequest.promise === promise) {
        sidebarSceneHistoryRequest = null;
      }
    }
  }

  let performerCounterRenderToken = 0;

  function removePerformerCounter() {
    // Invalidate any asynchronous render still waiting for settings/history.
    performerCounterRenderToken += 1;
    document.querySelectorAll('[id="individual-o-performer-counter"]').forEach(node => node.remove());
  }

  async function loadPerformerHistory(performerId) {
    const sceneData = await gql(`query IndividualOPerformerScenes($performerId: ID!) {
      findScenes(scene_filter: { performers: { value: [$performerId], modifier: INCLUDES } }, filter: { per_page: -1 }) {
        scenes { id title date custom_fields scene_markers { id title seconds } }
      }
    }`, { performerId });
    let imageData = null;
    try {
      imageData = await gql(`query IndividualOPerformerImages($performerId: ID!) {
        findImages(image_filter: { performers: { value: [$performerId], modifier: INCLUDES } }, filter: { per_page: -1 }) {
          images { id title date custom_fields }
        }
      }`, { performerId });
    } catch (imageError) {
      console.warn('[Individual O] Impossible de charger les O des images pour ce performer ; les O des scènes restent disponibles.', imageError);
    }

    const entries = [];
    const scenes = (sceneData && sceneData.findScenes && sceneData.findScenes.scenes) || [];
    const images = (imageData && imageData.findImages && imageData.findImages.images) || [];
    scenes.forEach(scene => {
      const raw = scene.custom_fields && scene.custom_fields[FIELD_KEY];
      if (!raw) return;
      let history; try { history = JSON.parse(raw); } catch (_) { return; }
      if (!Array.isArray(history)) return;
      history.forEach(entry => {
        if ((entry.performer_ids || []).map(String).includes(String(performerId))) {
          const marker = entry.marker_id
            ? (scene.scene_markers || []).find(item => String(item.id) === String(entry.marker_id))
            : null;
          entries.push({
            id: entry.id, date: entry.date, entity_type: 'scene',
            scene_id: String(scene.id),
            scene_title: scene.title || ('Scène #' + scene.id),
            scene_date: scene.date || '',
            marker_id: marker ? String(marker.id) : (entry.marker_id ? String(entry.marker_id) : null),
            marker_title: marker ? (marker.title || entry.marker_title || 'Marqueur') : (entry.marker_title || ''),
            marker_seconds: marker ? Number(marker.seconds) : (entry.marker_seconds != null ? Number(entry.marker_seconds) : entry.timestamp)
          });
        }
      });
    });
    images.forEach(image => {
      const raw = image.custom_fields && image.custom_fields[FIELD_KEY];
      if (!raw) return;
      let history;
      try { history = JSON.parse(raw); } catch (_) { return; }
      if (!Array.isArray(history)) return;
      history.forEach(entry => {
        if ((entry.performer_ids || []).map(String).includes(String(performerId))) {
          entries.push({ id: entry.id, date: entry.date, entity_type: 'image', image_id: String(image.id), image_title: image.title || ('Image #' + image.id), scene_title: image.title || ('Image #' + image.id) });
        }
      });
    });
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries;
  }

  // Reuse history results between performer pages and wall cards to avoid
  // issuing repeated GraphQL requests while Stash re-renders the wall.
  async function getCachedPerformerHistory(performerId) {
    const key = String(performerId);
    const cached = performerHistoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = loadPerformerHistory(key);
    performerHistoryCache.set(key, { promise, expiresAt: Date.now() + 45000 });
    try {
      return await promise;
    } catch (error) {
      performerHistoryCache.delete(key);
      throw error;
    }
  }

  function invalidatePerformerHistory(performerIds) {
    (performerIds || []).forEach(id => performerHistoryCache.delete(String(id)));
  }

  function createCardCounter(performerId, entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'individual-o-card-pill';
    button.dataset.performerId = String(performerId);
    button.title = 'Consulter l’historique des O individuels';
    button.setAttribute('aria-label', 'O individuels : ' + entries.length);
    button.innerHTML = individualOIconHTML() + '<strong>' + entries.length + '</strong>';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openPerformerHistory(String(performerId), entries);
    });
    return button;
  }

  function ensureCardPopoverRow(card) {
    let popovers = card.querySelector('.card-popovers');
    if (popovers) return popovers;

    // Stash omits the popover row entirely when all native counts are zero.
    // Create a dedicated row in the same location so the independent count
    // remains visible even when the native O-counter is absent.
    const divider = document.createElement('hr');
    divider.className = 'individual-o-card-divider';
    popovers = document.createElement('div');
    popovers.className = 'card-popovers individual-o-card-popovers';
    card.appendChild(divider);
    card.appendChild(popovers);
    return popovers;
  }

  async function scanPerformerCards() {
    const visible = await areIndividualCountersVisible();
    if (!visible) {
      document.querySelectorAll('.performer-card .individual-o-card-pill, .performer-card .individual-o-card-loading').forEach(node => node.remove());
      document.querySelectorAll('.performer-card .individual-o-card-popovers').forEach(row => {
        const card = row.closest('.performer-card');
        const divider = card && card.querySelector(':scope > .individual-o-card-divider');
        row.remove();
        if (divider) divider.remove();
      });
      return;
    }
    document.querySelectorAll('.performer-card').forEach(card => {
      const link = card.querySelector('a[href*="/performers/"]');
      if (!link) return;
      const match = link.getAttribute('href').match(/\/performers\/(\d+)/i);
      if (!match) return;
      const performerId = match[1];
      const popovers = ensureCardPopoverRow(card);
      const existing = popovers.querySelector('.individual-o-card-pill, .individual-o-card-loading');
      if (existing && existing.dataset.performerId === performerId) return;
      if (existing) existing.remove();

      const placeholder = document.createElement('button');
      placeholder.type = 'button';
      placeholder.className = 'individual-o-card-pill individual-o-card-loading';
      placeholder.dataset.performerId = performerId;
      placeholder.disabled = true;
      placeholder.innerHTML = individualOIconHTML() + '<strong>…</strong>';

      // In Stash v0.31.1 the native performer O counter is the only
      // .count-button in this ButtonGroup. Insert immediately after it.
      // If the native counter is zero Stash omits it, so append our own pill.
      const nativeOCounter = popovers.querySelector('.count-button');
      if (nativeOCounter) nativeOCounter.insertAdjacentElement('afterend', placeholder);
      else popovers.appendChild(placeholder);

      getCachedPerformerHistory(performerId).then(entries => {
        if (!placeholder.isConnected || placeholder.dataset.performerId !== performerId) return;
        placeholder.replaceWith(createCardCounter(performerId, entries));
      }).catch(error => {
        if (!placeholder.isConnected) return;
        placeholder.classList.add('has-error');
        placeholder.disabled = true;
        placeholder.querySelector('strong').textContent = '!';
        placeholder.title = 'Erreur de chargement : ' + error.message;
        console.error('[Individual O] Erreur compteur vignette', error);
      });
    });
  }

  function refreshPerformerCards(performerIds) {
    const ids = new Set((performerIds || []).map(String));
    document.querySelectorAll('.performer-card .individual-o-card-pill').forEach(node => {
      if (ids.has(node.dataset.performerId)) node.remove();
    });
    scanPerformerCards();
  }

  // Keep the profile counter beside the native rating/O controls, as in v0.2.1.
  function findPerformerCounterHost() {
    return document.querySelector('#performer-page .quality-group');
  }

  async function renderPerformerCounter(performerId) {
    // Only the newest render for the current performer may insert/update a badge.
    removePerformerCounter();
    const renderToken = ++performerCounterRenderToken;

    if (!(await areIndividualCountersVisible())) return;
    if (renderToken !== performerCounterRenderToken || currentPerformerId() !== performerId) return;

    const host = findPerformerCounterHost();
    if (!host) return;

    // A previous overlapping render or a Stash re-render may have left a badge behind.
    document.querySelectorAll('[id="individual-o-performer-counter"]').forEach(node => node.remove());
    if (renderToken !== performerCounterRenderToken || currentPerformerId() !== performerId) return;

    const counter = document.createElement('div');
    counter.id = 'individual-o-performer-counter';
    counter.innerHTML = '<button type="button" class="individual-o-profile-badge" disabled>' + individualOIconHTML() + '<strong>…</strong></button>';
    host.appendChild(counter);

    try {
      const entries = await getCachedPerformerHistory(performerId);
      if (
        renderToken !== performerCounterRenderToken ||
        !counter.isConnected ||
        currentPerformerId() !== performerId
      ) return;

      const button = counter.querySelector('button');
      button.disabled = false;
      button.querySelector('strong').textContent = String(entries.length);
      button.title = 'Consulter l’historique des O individuels';
      button.addEventListener('click', () => openPerformerHistory(performerId, entries));
    } catch (error) {
      if (renderToken !== performerCounterRenderToken || !counter.isConnected) return;
      counter.querySelector('strong').textContent = '!';
      counter.querySelector('button').title = 'Erreur de chargement : ' + error.message;
      console.error('[Individual O] Erreur compteur performeur', error);
    }
  }

  function openPerformerHistory(performerId, entries) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'individual-o-modal-backdrop';
    backdrop.className = 'individual-o-backdrop';
    const rows = entries.length ? entries.map(entry => {
      const isImage = entry.entity_type === 'image';
      const entityUrl = isImage
        ? '/images/' + encodeURIComponent(entry.image_id)
        : '/scenes/' + encodeURIComponent(entry.scene_id);
      const thumb = isImage
        ? '<a class="individual-o-history-thumb-link" href="' + entityUrl + '" title="Ouvrir l’image"><img class="individual-o-history-marker-thumb" src="/image/' + encodeURIComponent(entry.image_id) + '/thumbnail" alt="" loading="lazy"></a>'
        : (entry.marker_id
          ? '<a class="individual-o-history-thumb-link" href="' + entityUrl + (entry.marker_seconds != null ? '?t=' + encodeURIComponent(Math.floor(Number(entry.marker_seconds))) : '') + '" title="Ouvrir la scène au marqueur ' + escapeHTML(entry.marker_title || '') + '"><img class="individual-o-history-marker-thumb" src="/scene/' + encodeURIComponent(entry.scene_id) + '/scene_marker/' + encodeURIComponent(entry.marker_id) + '/screenshot" alt="" loading="lazy"></a>'
          : '');
      return '<div class="individual-o-history-row">' + thumb + '<div class="individual-o-history-main"><div class="individual-o-history-date">' + escapeHTML(formatDate(entry.date)) + '</div>' +
        '<a class="individual-o-scene-link" href="' + entityUrl + '">' + escapeHTML(entry.scene_title) + '</a></div>' +
        '</div>';
    }).join('') : '<p class="individual-o-empty">Aucun O individuel enregistré pour ce performeur.</p>';
    backdrop.innerHTML = '<section class="individual-o-modal" role="dialog" aria-modal="true" aria-label="Historique des O individuels">' +
      '<header class="individual-o-header"><div><div class="individual-o-kicker">INDIVIDUAL O</div><h2>Historique individuel</h2></div><button class="individual-o-close" type="button" aria-label="Fermer">×</button></header>' +
      '<div class="individual-o-content"><div class="individual-o-scene-title">' + entries.length + (ioIsFrench ? ' O individuel(s)' : ' Individual O(s)') + '</div>' + rows + '</div></section>';
    document.body.appendChild(backdrop);
    backdrop.querySelector('.individual-o-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  }

  function renderLauncher(sceneId) {
    const root = ensureRoot();
    root.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'individual-o-launcher';
    button.innerHTML = individualOIconHTML('individual-o-launcher-icon') + '<span>Enregistrer un O individuel</span>';
    button.title = 'Enregistrer un O pour un ou plusieurs performeurs de cette scène';
    button.addEventListener('click', () => openManager(sceneId));
    root.appendChild(button);
    placeLauncher(root);
  }

  async function loadScene(sceneId) {
    const data = await gql(`query IndividualOScene($id: ID!) {
      findScene(id: $id) {
        id title custom_fields o_history
        performers { id name }
        scene_markers { id title seconds }
      }
    }`, { id: sceneId });
    if (!data || !data.findScene) throw new Error('Scène introuvable.');
    const scene = data.findScene;
    let history = [];
    const raw = scene.custom_fields && scene.custom_fields[FIELD_KEY];
    if (raw) {
      try { history = JSON.parse(raw); } catch (e) { history = []; }
    }
    if (!Array.isArray(history)) history = [];
    return { scene, history };
  }

  // Index local des images portant des O individuels. Il est alimenté à
  // l'ouverture d'une image déjà annotée et à chaque enregistrement ; aucune
  // recherche globale dans les centaines de milliers d'images n'est nécessaire.
  const IMAGE_INDEX_KEY = 'individual-o-image-index-v1';
  const IMAGE_INDEX_CONFIG_KEY = 'image_index_v1';
  let persistentImageIndex = null;
  let persistentImageIndexPromise = null;
  let imageIndexWritePromise = Promise.resolve();

  function readLegacyLocalImageIndex() {
    try {
      const value = JSON.parse(localStorage.getItem(IMAGE_INDEX_KEY) || '[]');
      return Array.isArray(value) ? Array.from(new Set(value.map(String))) : [];
    } catch (_) { return []; }
  }

  async function readIndividualImageIndex() {
    if (persistentImageIndex) return persistentImageIndex.slice();
    if (persistentImageIndexPromise) return persistentImageIndexPromise;
    persistentImageIndexPromise = (async () => {
      try {
        const data = await gql(`query IndividualOImageIndexConfig {
          configuration { plugins(include: ["individual-o"]) }
        }`);
        const configs = data && data.configuration && data.configuration.plugins;
        const pluginConfig = configs && (configs['individual-o'] || configs);
        const stored = pluginConfig && pluginConfig[IMAGE_INDEX_CONFIG_KEY];
        const serverIds = Array.isArray(stored) ? stored.map(String) : [];
        // Fusionne toujours l'ancien index du navigateur avec celui de Stash.
        // Cela permet à Opera de migrer ses données même si un autre navigateur
        // a initialisé auparavant un index serveur encore vide.
        const localIds = readLegacyLocalImageIndex();
        persistentImageIndex = Array.from(new Set(serverIds.concat(localIds)));
        if (!Array.isArray(stored) || persistentImageIndex.length !== serverIds.length) {
          await persistIndividualImageIndex(persistentImageIndex);
        }
      } catch (error) {
        console.warn('[Individual O] Lecture de l’index persistant impossible ; utilisation du cache local temporaire.', error);
        persistentImageIndex = readLegacyLocalImageIndex();
      }
      return persistentImageIndex.slice();
    })();
    try { return await persistentImageIndexPromise; }
    finally { persistentImageIndexPromise = null; }
  }

  async function persistIndividualImageIndex(ids) {
    const normalized = Array.from(new Set((ids || []).map(String)));
    imageIndexWritePromise = imageIndexWritePromise.then(async () => {
      const currentData = await gql(`query IndividualOReadPluginConfig {
        configuration { plugins(include: ["individual-o"]) }
      }`);
      const configs = currentData && currentData.configuration && currentData.configuration.plugins;
      const existing = configs && (configs['individual-o'] || configs);
      const merged = Object.assign({}, existing || {}, { [IMAGE_INDEX_CONFIG_KEY]: normalized });
      await gql(`mutation IndividualOWritePluginConfig($input: Map!) {
        configurePlugin(plugin_id: "individual-o", input: $input)
      }`, { input: merged });
    });
    try { await imageIndexWritePromise; }
    catch (error) { console.error('[Individual O] Échec de sauvegarde de l’index dans Stash.', error); throw error; }
  }

  async function updateIndividualImageIndex(imageId, hasEntries) {
    const id = String(imageId);
    const previous = await readIndividualImageIndex();
    const hadEntry = previous.includes(id);
    if (hadEntry === !!hasEntries) return;
    const ids = previous.filter(value => value !== id);
    if (hasEntries) ids.push(id);
    persistentImageIndex = ids;
    // Miroir local facultatif : accélère les lectures et permet une récupération
    // temporaire si le serveur est indisponible.
    try { localStorage.setItem(IMAGE_INDEX_KEY, JSON.stringify(ids)); } catch (_) {}
    await persistIndividualImageIndex(ids);
  }

  async function loadImage(imageId) {
    const data = await gql(`query IndividualOImage($id: ID!) {
      findImage(id: $id) { id title date custom_fields performers { id name } }
    }`, { id: imageId });
    if (!data || !data.findImage) throw new Error('Image introuvable.');
    const image = data.findImage;
    let history = [];
    const raw = image.custom_fields && image.custom_fields[FIELD_KEY];
    if (raw) { try { history = JSON.parse(raw); } catch (_) { history = []; } }
    if (!Array.isArray(history)) history = [];
    // Ouvre/visite l'image : si elle contient déjà des O, elle rejoint l'index.
    if (history.length) await updateIndividualImageIndex(imageId, true);
    return { image, history };
  }

  async function saveImageHistory(imageId, history) {
    await gql(`mutation IndividualOSaveImage($input: ImageUpdateInput!) {
      imageUpdate(input: $input) { id }
    }`, { input: { id: String(imageId), custom_fields: { partial: { [FIELD_KEY]: JSON.stringify(history) } } } });
    await updateIndividualImageIndex(imageId, Array.isArray(history) && history.length > 0);
    invalidateIndividualSortCache();
    globalHistoryCache = null;
    performerHistoryCache.clear();
    // Le panneau de l'image est géré séparément de l'arbre React Stash.
    // Le recharger ici garantit l'actualisation après création, édition ou suppression.
    await renderImageSidebarIndividualHistory(imageId, true);
  }

  function ensureImageHeaderLauncher(imageId) {
    const existing = document.getElementById('individual-o-image-header-launcher');
    const toolbar = document.querySelector('.image-toolbar');
    if (!toolbar) { if (existing) existing.remove(); return; }
    const groups = toolbar.querySelectorAll('.image-toolbar-group');
    const actionGroup = groups.length > 1 ? groups[1] : toolbar;
    const operations = Array.from(actionGroup.children).find(child =>
      child.querySelector && child.querySelector('button.dropdown-toggle')
    ) || null;
    if (existing && existing.dataset.imageId === String(imageId) && existing.parentElement === actionGroup) {
      if (operations && existing.nextElementSibling !== operations) actionGroup.insertBefore(existing, operations);
      return;
    }
    if (existing) existing.remove();    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'individual-o-image-header-launcher';
    button.className = 'individual-o-header-launcher minimal btn btn-secondary';
    button.dataset.imageId = String(imageId);
    button.innerHTML = individualOIconHTML('individual-o-launcher-icon');
    button.title = 'Enregistrer un O individuel';
    button.setAttribute('aria-label', 'Enregistrer un O individuel');
    button.addEventListener('click', () => openImageManager(imageId));
    if (operations) actionGroup.insertBefore(button, operations);
    else actionGroup.appendChild(button);
  }

  function findSploogeMarker(scene, timestamp) {
    if (timestamp == null || !Number.isFinite(Number(timestamp))) return null;
    const markers = (scene && scene.scene_markers) || [];
    const matches = markers.filter(marker => {
      const titleMatches = String(marker.title || '').trim().toLocaleLowerCase() === newMarkerTitle.toLocaleLowerCase();
      const seconds = Number(marker.seconds);
      return titleMatches && Number.isFinite(seconds) && Math.abs(seconds - Number(timestamp)) <= MARKER_TOLERANCE_SECONDS;
    });
    if (!matches.length) return null;
    matches.sort((a, b) => Math.abs(Number(a.seconds) - Number(timestamp)) - Math.abs(Number(b.seconds) - Number(timestamp)));
    return matches[0];
  }

  function applyMarkerAssociation(entry, scene) {
    const marker = findSploogeMarker(scene, entry.timestamp);
    if (marker) {
      entry.marker_id = String(marker.id);
      entry.marker_title = marker.title || newMarkerTitle;
      entry.marker_seconds = Number(marker.seconds);
    } else {
      delete entry.marker_id;
      delete entry.marker_title;
      delete entry.marker_seconds;
    }
    return marker;
  }

  async function createSploogeMarker(sceneId, seconds) {
    const tagData = await gql(`query IndividualOFindSploogesTag {
      allTags { id name }
    }`);
    const tag = (tagData.allTags || []).find(item =>
      String(item.name || '').trim().replace(/^#/, '').toLocaleLowerCase() === newMarkerPrimaryTag.replace(/^#/, '').toLocaleLowerCase()
    );
    if (!tag) throw new Error('Le tag principal « ' + newMarkerPrimaryTag + ' » est introuvable. Aucun marqueur n’a été créé.');

    const result = await gql(`mutation IndividualOCreateSploogeMarker($input: SceneMarkerCreateInput!) {
      sceneMarkerCreate(input: $input) { id title seconds }
    }`, {
      input: {
        scene_id: String(sceneId),
        title: newMarkerTitle,
        seconds: Number(seconds),
        primary_tag_id: String(tag.id),
        tag_ids: [String(tag.id)]
      }
    });
    if (!result || !result.sceneMarkerCreate) throw new Error('Stash n’a pas confirmé la création du marqueur « ' + newMarkerTitle + ' ».');
    return result.sceneMarkerCreate;
  }

  async function saveHistory(sceneId, history) {
    const value = JSON.stringify(history);
    await gql(`mutation IndividualOSave($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) { id }
    }`, {
      input: {
        id: sceneId,
        custom_fields: { partial: { [FIELD_KEY]: value } }
      }
    });
    invalidateIndividualSortCache();
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short', timeStyle: 'short'
    }).format(date);
  }

  function closeModal() {
    const modal = document.getElementById('individual-o-modal-backdrop');
    if (modal) modal.remove();
  }

  function showIndividualDialog(options) {
    const config = Object.assign({
      title: 'Individual O',
      message: '',
      detail: '',
      buttons: [{ value: 'confirm', label: 'Confirmer', className: 'is-primary' }, { value: 'cancel', label: 'Annuler', className: '' }]
    }, options || {});
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'individual-o-dialog-backdrop';
      backdrop.innerHTML = '<section class="individual-o-dialog" role="alertdialog" aria-modal="true" aria-labelledby="individual-o-dialog-title" aria-describedby="individual-o-dialog-message">' +
        '<header class="individual-o-dialog-header"><span class="individual-o-kicker">INDIVIDUAL O</span><button type="button" class="individual-o-dialog-close" aria-label="Fermer">×</button></header>' +
        '<div class="individual-o-dialog-body"><h3 id="individual-o-dialog-title"></h3><p id="individual-o-dialog-message"></p><p class="individual-o-dialog-detail"></p></div>' +
        '<footer class="individual-o-dialog-actions"></footer></section>';
      const title = backdrop.querySelector('#individual-o-dialog-title');
      const message = backdrop.querySelector('#individual-o-dialog-message');
      const detail = backdrop.querySelector('.individual-o-dialog-detail');
      title.textContent = config.title;
      message.textContent = config.message;
      detail.textContent = config.detail || '';
      detail.hidden = !config.detail;
      const actions = backdrop.querySelector('.individual-o-dialog-actions');
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(value);
      };
      config.buttons.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'individual-o-dialog-button' + (item.className ? ' ' + item.className : '');
        button.textContent = item.label;
        button.addEventListener('click', () => finish(item.value));
        actions.appendChild(button);
        if (index === 0) button.dataset.initialFocus = 'true';
      });
      const cancel = () => finish('cancel');
      backdrop.querySelector('.individual-o-dialog-close').addEventListener('click', cancel);
      backdrop.addEventListener('click', event => { if (event.target === backdrop) cancel(); });
      const onKeyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
          const focusable = Array.from(backdrop.querySelectorAll('button:not(:disabled)'));
          if (!focusable.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      document.body.appendChild(backdrop);
      document.addEventListener('keydown', onKeyDown, true);
      const initial = backdrop.querySelector('[data-initial-focus="true"]');
      if (initial) initial.focus();
    });
  }

  function confirmIndividualDelete(detail) {
    return showIndividualDialog({
      title: 'Supprimer cet O individuel ?',
      message: 'Cette entrée sera supprimée définitivement de l’historique.',
      detail: detail || '',
      buttons: [
        { value: 'confirm', label: 'Supprimer', className: 'is-danger' },
        { value: 'cancel', label: 'Annuler', className: '' }
      ]
    }).then(value => value === 'confirm');
  }

  async function openManager(sceneId) {
    await loadMarkerSettings();
    // Mode A: freeze the playback position at the exact moment the modal opens.
    const capturedTimestamp = currentPlaybackTime();
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'individual-o-modal-backdrop';
    backdrop.className = 'individual-o-backdrop';
    backdrop.innerHTML = '<section class="individual-o-modal" role="dialog" aria-modal="true" aria-label="Gestion des O individuels">' +
      '<header class="individual-o-header"><div><div class="individual-o-kicker">INDIVIDUAL O</div><h2>Gestion des O</h2></div><button class="individual-o-close" type="button" aria-label="Fermer">×</button></header>' +
      '<div class="individual-o-content"><p class="individual-o-loading">Chargement de la scène…</p></div></section>';
    document.body.appendChild(backdrop);
    backdrop.querySelector('.individual-o-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    const content = backdrop.querySelector('.individual-o-content');

    try {
      const { scene, history } = await loadScene(sceneId);
      const performers = scene.performers || [];
      const names = Object.fromEntries(performers.map(p => [String(p.id), p.name]));
      const sploogeMarkers = (scene.scene_markers || []).filter(marker =>
        String(marker.title || '').trim().toLocaleLowerCase() === newMarkerTitle.toLocaleLowerCase() &&
        Number.isFinite(Number(marker.seconds))
      ).sort((a, b) => Number(a.seconds) - Number(b.seconds));
      const markerChoices = sploogeMarkers.length ? sploogeMarkers.map(marker =>
        '<label class="individual-o-marker-choice"><input type="radio" name="individual-o-marker-choice" value="' + escapeHTML(marker.id) + '"><img src="/scene/' + encodeURIComponent(sceneId) + '/scene_marker/' + encodeURIComponent(marker.id) + '/screenshot" alt=""><span><strong>' + escapeHTML(newMarkerTitle) + '</strong><small>' + escapeHTML(formatTimestamp(Number(marker.seconds))) + '</small></span></label>'
      ).join('') : '<p class="individual-o-empty">Aucun marqueur « ' + escapeHTML(newMarkerTitle) + ' » dans cette scène. Tu peux tout de même enregistrer un O sans marqueur.</p>';
      content.innerHTML = '<div class="individual-o-scene-title">' + escapeHTML(scene.title || ('Scène #' + scene.id)) + '</div>' +
        '<div class="individual-o-marker-section"><div class="individual-o-section-title">' + (ioIsFrench ? 'Choisir le marqueur ' : 'Choose marker ') + escapeHTML(newMarkerTitle) + '</div>' +
        '<div class="individual-o-marker-choices">' + markerChoices + '</div></div>' +
        '<div class="individual-o-classic-date"><label for="individual-o-classic-o-select">Date de l’O individuel</label>' +
        '<select id="individual-o-classic-o-select" class="individual-o-classic-o-select">' +
        '<option value="">Maintenant (date et heure actuelles)</option>' +
        ((scene.o_history || []).slice().reverse().map((classicDate, index) =>
          '<option value="' + escapeHTML(classicDate) + '">' + (ioIsFrench ? 'O classique — ' : 'Classical O — ') + escapeHTML(formatDate(classicDate)) + '</option>'
        ).join('')) +
        '</select>' +
        '<div class="individual-o-classic-help">' + ((scene.o_history || []).length
          ? 'Tu peux réutiliser un O classique pour plusieurs attributions individuelles.'
          : 'Aucun O classique enregistré dans cette scène.') + '</div></div>' +
        '<div class="individual-o-section-title">À qui attribuer ce O ?</div>' +
        (performers.length ? '<div class="individual-o-performers">' + performers.map(p =>
          '<label class="individual-o-performer"><input type="checkbox" value="' + escapeHTML(p.id) + '"><span>' + escapeHTML(p.name) + '</span></label>'
        ).join('') + '</div>' : '<p class="individual-o-empty">Aucun performeur n’est associé à cette scène.</p>') +
        '<div class="individual-o-actions"><button type="button" class="individual-o-save" ' + (performers.length ? '' : 'disabled') + '>＋ ' + (ioIsFrench ? 'Enregistrer un O' : 'Record an O') + '</button><span class="individual-o-status" aria-live="polite"></span></div>' +
        '<div class="individual-o-divider"></div><div class="individual-o-section-title">' + (ioIsFrench ? 'Historique de cette scène' : 'History for this scene') + ' <span class="individual-o-count">' + history.length + '</span></div>' +
        '<div class="individual-o-history">' + renderHistory(history, names, null, sceneId) + '</div>';

      content.querySelector('.individual-o-save').addEventListener('click', async event => {
        const selected = Array.from(content.querySelectorAll('.individual-o-performer input:checked')).map(input => input.value);
        const status = content.querySelector('.individual-o-status');
        if (!selected.length) {
          status.textContent = 'Sélectionne au moins un performeur.';
          status.className = 'individual-o-status is-error';
          return;
        }
        const button = event.currentTarget;
        const selectedMarkerIdBeforeSave = content.querySelector('input[name="individual-o-marker-choice"]:checked')?.value || '';
        let createMarkerAtCurrentTime = false;
        if (!selectedMarkerIdBeforeSave && markerCreationPromptEnabled && newMarkerTitle && newMarkerPrimaryTag) {
          const markerChoice = await showIndividualDialog({
            title: ioIsFrench
  ? 'Aucun marqueur « ' + newMarkerTitle + ' » sélectionné'
  : 'No « ' + newMarkerTitle + ' » marker selected',
            message: 'Comment veux-tu enregistrer cet O individuel ?',
            detail: ioIsFrench
  ? 'Tu peux créer automatiquement un marqueur « ' + newMarkerTitle + ' » associé au tag principal « ' + newMarkerPrimaryTag + ' » à la position actuelle de la vidéo, enregistrer l’O sans marqueur, ou annuler.'
  : 'You can automatically create a « ' + newMarkerTitle + ' » marker associated with the primary tag « ' + newMarkerPrimaryTag + ' » at the current video position, save the O without a marker, or cancel.',
            buttons: [
              { value: 'create', label: ioIsFrench ? 'Créer le marqueur et l’O' : 'Create marker and O', className: 'is-primary' },
              { value: 'without', label: ioIsFrench ? 'Enregistrer sans marqueur' : 'Save without marker', className: '' },
              { value: 'cancel', label: ioIsFrench ? 'Annuler' : 'Cancel', className: '' }
            ]
          });
          if (markerChoice === 'cancel') return;
          createMarkerAtCurrentTime = markerChoice === 'create';
        }
        button.disabled = true;
        status.textContent = 'Enregistrement…';
        status.className = 'individual-o-status';
        try {
          const fresh = await loadScene(sceneId);
          const entries = fresh.history;
          const classicODate = content.querySelector('#individual-o-classic-o-select')?.value || '';
          const selectedDate = classicODate ? new Date(classicODate) : new Date();
          if (Number.isNaN(selectedDate.getTime())) throw new Error('La date de l’O classique sélectionné est invalide.');
          const selectedMarkerId = content.querySelector('input[name="individual-o-marker-choice"]:checked')?.value || '';
          let selectedMarker = selectedMarkerId
            ? (fresh.scene.scene_markers || []).find(marker => String(marker.id) === String(selectedMarkerId))
            : null;
          if (selectedMarkerId && !selectedMarker) throw new Error('Le marqueur sélectionné est introuvable. Recharge la fenêtre.');
          if (!selectedMarker && createMarkerAtCurrentTime) {
            const currentTime = currentPlaybackTime();
            if (currentTime == null) throw new Error('Impossible de récupérer la position actuelle de la vidéo. Aucun marqueur n’a été créé.');
            selectedMarker = await createSploogeMarker(sceneId, currentTime);
          }
          const newEntry = {
            id: makeId(), date: selectedDate.toISOString(), performer_ids: selected,
            timestamp: selectedMarker ? Number(selectedMarker.seconds) : capturedTimestamp
          };
          if (selectedMarker) {
            newEntry.marker_id = String(selectedMarker.id);
            newEntry.marker_title = selectedMarker.title || newMarkerTitle;
            newEntry.marker_seconds = Number(selectedMarker.seconds);
          }
          entries.unshift(newEntry);
          await saveHistory(sceneId, entries);

          // Lorsque « Maintenant » est sélectionné, créer aussi l'événement
          // O natif Stash avec exactement le même timestamp que l'entrée individuelle.
          // Une date classique réutilisée (sélecteur non vide) ne déclenche jamais cette action.
          let classicOCreationError = null;
          let classicOCreated = false;
          const syncClassicSceneO = !classicODate && await isClassicSceneSyncEnabled();
          if (syncClassicSceneO) {
            try {
              const classicOResult = await gql(`mutation IndividualOCreateClassicO($id: ID!, $times: [Timestamp!]) {
                sceneAddO(id: $id, times: $times) { count history }
              }`, {
                id: String(sceneId),
                times: [selectedDate.toISOString()]
              });
              classicOCreated = !!(classicOResult && classicOResult.sceneAddO);
              const cacheUpdated = updateNativeSceneApolloCache(sceneId, classicOResult && classicOResult.sceneAddO);
              if (classicOCreated) updateNativePerformerApolloCache(selected);
              if (!cacheUpdated) {
                const client = window.__individualOApolloClient;
                if (client && typeof client.refetchQueries === 'function') {
                  await client.refetchQueries({ include: ['FindScene'] });
                }
              }
            } catch (classicError) {
              classicOCreationError = classicError;
            }
          }

          renderSceneSidebarIndividualHistory(sceneId, true);
          markerCounterCache.delete(String(sceneId));
          scheduleMarkerCounterScan(true);
          invalidatePerformerHistory(selected);
          refreshPerformerCards(selected);
          selected.forEach(id => {
            const checkbox = content.querySelector('.individual-o-performer input[value="' + CSS.escape(id) + '"]');
            if (checkbox) checkbox.checked = false;
          });
          content.querySelector('.individual-o-count').textContent = entries.length;
          content.querySelector('.individual-o-history').innerHTML = renderHistory(entries, names, null, sceneId);
          if (classicOCreationError) {
            status.textContent = 'O individuel enregistré, mais la création de l’O classique a échoué : ' +
              (classicOCreationError.message || 'erreur GraphQL inconnue') + '.';
            status.className = 'individual-o-status is-error';
          } else if (syncClassicSceneO) {
            status.textContent = 'O individuel et O classique enregistrés à la même date et heure.' +
              (selectedMarker ? ' Marqueur Splooge : ' + formatTimestamp(selectedMarker.seconds) + '.' : ' Aucun marqueur Splooge associé.');
            status.className = 'individual-o-status is-success';
          } else {
            status.textContent = selectedMarker
              ? 'O enregistré et associé au marqueur Splooge (' + formatTimestamp(selectedMarker.seconds) + ').'
              : 'O enregistré sans marqueur Splooge associé.';
            status.className = 'individual-o-status is-success';
          }
        } catch (error) {
          status.textContent = error.message || 'Échec de l’enregistrement.';
          status.className = 'individual-o-status is-error';
        } finally {
          button.disabled = false;
        }
      });

      content.querySelector('.individual-o-history').addEventListener('click', async event => {
        const editButton = event.target.closest('[data-edit-entry]');
        const cancelButton = event.target.closest('[data-cancel-edit]');
        const saveButton = event.target.closest('[data-save-date]');
        const seekButton = event.target.closest('[data-seek-timestamp]');
        const deleteButton = event.target.closest('[data-delete-entry]');
        const historyNode = content.querySelector('.individual-o-history');

        if (seekButton) {
          event.preventDefault();
          event.stopPropagation();
          seekToTimestamp(Number(seekButton.dataset.seekTimestamp));
          return;
        }

        if (editButton) {
          const entryId = editButton.dataset.editEntry;
          const fresh = await loadScene(sceneId);
          historyNode.innerHTML = renderHistory(fresh.history, names, entryId, sceneId);
          const input = historyNode.querySelector('[data-date-input]');
          if (input) { input.focus(); input.select(); }
          return;
        }

        if (cancelButton) {
          const fresh = await loadScene(sceneId);
          historyNode.innerHTML = renderHistory(fresh.history, names, null, sceneId);
          return;
        }

        if (saveButton) {
          const entryId = saveButton.dataset.saveDate;
          const input = historyNode.querySelector('[data-date-input="' + CSS.escape(entryId) + '"]');
          const newDate = input ? parseLocalDateTime(input.value) : null;
          const timestampInput = historyNode.querySelector('[data-timestamp-input="' + CSS.escape(entryId) + '"]');
          const newTimestamp = timestampInput && timestampInput.value.trim() ? parseTimestamp(timestampInput.value) : null;
          if (!newDate || (timestampInput && timestampInput.value.trim() && newTimestamp == null)) {
            window.alert('Date, heure ou position vidéo invalide. Utilise MM:SS ou HH:MM:SS pour la position.');
            return;
          }
          saveButton.disabled = true;
          try {
            const fresh = await loadScene(sceneId);
            const target = fresh.history.find(entry => String(entry.id) === String(entryId));
            if (!target) throw new Error('Cette entrée n’existe plus. Recharge la fenêtre.');
            target.date = newDate;
            target.timestamp = newTimestamp;
            await loadMarkerSettings();
            applyMarkerAssociation(target, fresh.scene);
            await saveHistory(sceneId, fresh.history);
            renderSceneSidebarIndividualHistory(sceneId, true);
            markerCounterCache.delete(String(sceneId));
            scheduleMarkerCounterScan(true);
            const affected = target.performer_ids || [];
            invalidatePerformerHistory(affected);
            refreshPerformerCards(affected);
            historyNode.innerHTML = renderHistory(fresh.history, names, null, sceneId);
          } catch (error) {
            window.alert('Impossible de modifier la date : ' + error.message);
            saveButton.disabled = false;
          }
          return;
        }

        if (deleteButton) {
          if (!(await confirmIndividualDelete())) return;
          deleteButton.disabled = true;
          try {
            const fresh = await loadScene(sceneId);
            const removed = fresh.history.find(entry => String(entry.id) === String(deleteButton.dataset.deleteEntry));
            const updated = fresh.history.filter(entry => String(entry.id) !== String(deleteButton.dataset.deleteEntry));
            await saveHistory(sceneId, updated);
            renderSceneSidebarIndividualHistory(sceneId, true);
            markerCounterCache.delete(String(sceneId));
            scheduleMarkerCounterScan(true);
            const affected = (removed && removed.performer_ids) || [];
            invalidatePerformerHistory(affected);
            refreshPerformerCards(affected);
            content.querySelector('.individual-o-count').textContent = updated.length;
            historyNode.innerHTML = renderHistory(updated, names, null, sceneId);
          } catch (error) {
            window.alert('Impossible de supprimer cet O : ' + error.message);
            deleteButton.disabled = false;
          }
        }
      });
    } catch (error) {
      content.innerHTML = '<p class="individual-o-error">Impossible de charger la scène : ' + escapeHTML(error.message) + '</p>';
    }
  }

  async function openImageManager(imageId) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'individual-o-modal-backdrop'; backdrop.className = 'individual-o-backdrop';
    backdrop.innerHTML = '<section class="individual-o-modal" role="dialog" aria-modal="true" aria-label="Gestion des O individuels"><header class="individual-o-header"><div><div class="individual-o-kicker">INDIVIDUAL O</div><h2>Gestion des O</h2></div><button class="individual-o-close" type="button" aria-label="Fermer">×</button></header><div class="individual-o-content"><p class="individual-o-loading">Chargement de l’image…</p></div></section>';
    document.body.appendChild(backdrop);
    backdrop.querySelector('.individual-o-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    const content = backdrop.querySelector('.individual-o-content');
    try {
      const { image, history } = await loadImage(imageId);
      const performers = image.performers || [];
      const names = Object.fromEntries(performers.map(p => [String(p.id), p.name]));
      content.innerHTML = '<div class="individual-o-scene-title">' + escapeHTML(image.title || ('Image #' + image.id)) + '</div>' +
        '<div class="individual-o-classic-date"><label for="individual-o-image-date-select">Date de l’O individuel</label>' +
        '<select id="individual-o-image-date-select" class="individual-o-classic-o-select">' +
        '<option value="">Maintenant (date et heure actuelles)</option>' +
        (image.date ? '<option value="' + escapeHTML(image.date) + '">Date de l’image — ' + escapeHTML(formatDate(image.date)) + '</option>' : '') +
        '</select>' +
        '<div class="individual-o-classic-help">Tu peux utiliser la date actuelle ou la date de l’image.</div></div>' +
        '<div class="individual-o-section-title">À qui attribuer ce O ?</div>' +
        (performers.length ? '<div class="individual-o-performers">' + performers.map(p => '<label class="individual-o-performer"><input type="checkbox" value="' + escapeHTML(p.id) + '"><span>' + escapeHTML(p.name) + '</span></label>').join('') + '</div>' : '<p class="individual-o-empty">Aucun performeur n’est associé à cette image.</p>') +
        '<div class="individual-o-actions"><button type="button" class="individual-o-save" ' + (performers.length ? '' : 'disabled') + '>＋ ' + (ioIsFrench ? 'Enregistrer un O' : 'Record an O') + '</button><span class="individual-o-status" aria-live="polite"></span></div>' +
        '<div class="individual-o-divider"></div><div class="individual-o-section-title">Historique de cette image <span class="individual-o-count">' + history.length + '</span></div>' +
        '<div class="individual-o-history">' + renderImageHistory(history, names, null, imageId) + '</div>';
      content.querySelector('.individual-o-save').addEventListener('click', async event => {
        const selected = Array.from(content.querySelectorAll('.individual-o-performer input:checked')).map(input => input.value);
        const status = content.querySelector('.individual-o-status');
        if (!selected.length) { status.textContent = 'Sélectionne au moins un performeur.'; status.className = 'individual-o-status is-error'; return; }
        const button = event.currentTarget; button.disabled = true; status.textContent = 'Enregistrement…'; status.className = 'individual-o-status';
        try {
          const fresh = await loadImage(imageId);
          const selectedDateValue = content.querySelector('#individual-o-image-date-select')?.value || '';
          const selectedDate = selectedDateValue ? new Date(selectedDateValue).toISOString() : new Date().toISOString();
          if (Number.isNaN(new Date(selectedDate).getTime())) throw new Error('Date ou heure invalide.');
          const entry = { id: makeId(), date: selectedDate, performer_ids: selected };
          fresh.history.unshift(entry);
          await saveImageHistory(imageId, fresh.history);
          let classicOError = null;
          const syncClassicImageO = await isClassicImageSyncEnabled();
          if (syncClassicImageO) {
            try {
              // Les images n'ont pas d'historique O horodaté dans Stash : on incrémente
              // leur compteur natif d'une unité à chaque O individuel créé, si l'option est active.
              const classicOResult = await gql(`mutation IndividualOCreateClassicImageO($id: ID!) {
                imageIncrementO(id: $id)
              }`, { id: String(imageId) });
              const newCount = classicOResult && classicOResult.imageIncrementO;
              if (newCount == null) throw new Error('Stash n’a pas renvoyé le nouveau compteur O de l’image.');
              updateNativeImageApolloCache(imageId, newCount);
              updateNativePerformerApolloCache(selected);
            } catch (classicError) {
              classicOError = classicError;
            }
          }
          invalidatePerformerHistory(selected); refreshPerformerCards(selected);
          content.querySelectorAll('.individual-o-performer input:checked').forEach(input => { input.checked = false; });
          content.querySelector('.individual-o-count').textContent = fresh.history.length;
          content.querySelector('.individual-o-history').innerHTML = renderImageHistory(fresh.history, names, null, imageId);
          if (classicOError) {
            status.textContent = 'O individuel enregistré, mais l’incrémentation du O classique a échoué : ' +
              (classicOError.message || 'erreur GraphQL inconnue') + '.';
            status.className = 'individual-o-status is-error';
          } else {
            status.textContent = syncClassicImageO
              ? 'O individuel enregistré et compteur O classique de l’image incrémenté.'
              : 'O individuel enregistré. La synchronisation du O classique est désactivée dans les paramètres.';
            status.className = 'individual-o-status is-success';
          }
        } catch (error) { status.textContent = error.message || 'Échec de l’enregistrement.'; status.className = 'individual-o-status is-error'; }
        finally { button.disabled = false; }
      });
      content.querySelector('.individual-o-history').addEventListener('click', async event => {
        const edit = event.target.closest('[data-image-edit]');
        const cancel = event.target.closest('[data-image-cancel]');
        const save = event.target.closest('[data-image-save]');
        const remove = event.target.closest('[data-image-delete]');
        const host = content.querySelector('.individual-o-history');
        if (edit || cancel) {
          const fresh = await loadImage(imageId);
          host.innerHTML = renderImageHistory(fresh.history, names, edit ? edit.dataset.imageEdit : null, imageId);
          return;
        }
        if (save) {
          const id = save.dataset.imageSave; const input = host.querySelector('[data-image-date="' + CSS.escape(id) + '"]');
          const date = input && parseLocalDateTime(input.value);
          if (!date) { window.alert('Date ou heure invalide.'); return; }
          const fresh = await loadImage(imageId); const target = fresh.history.find(item => String(item.id) === String(id));
          if (!target) return;
          target.date = date; await saveImageHistory(imageId, fresh.history);
          invalidatePerformerHistory(target.performer_ids || []); refreshPerformerCards(target.performer_ids || []);
          host.innerHTML = renderImageHistory(fresh.history, names, null, imageId); return;
        }
        if (remove) {
          if (!(await confirmIndividualDelete())) return;
          const fresh = await loadImage(imageId); const removed = fresh.history.find(item => String(item.id) === String(remove.dataset.imageDelete));
          fresh.history = fresh.history.filter(item => String(item.id) !== String(remove.dataset.imageDelete));
          await saveImageHistory(imageId, fresh.history);
          const affected = removed && removed.performer_ids || []; invalidatePerformerHistory(affected); refreshPerformerCards(affected);
          content.querySelector('.individual-o-count').textContent = fresh.history.length;
          host.innerHTML = renderImageHistory(fresh.history, names, null, imageId);
        }
      });
    } catch (error) { content.innerHTML = '<p class="individual-o-error">Impossible de charger l’image : ' + escapeHTML(error.message) + '</p>'; }
  }

  function renderImageHistory(history, names, editingId, imageId) {
    if (!history.length) return '<p class="individual-o-empty">Aucun O individuel enregistré.</p>';
    return history.slice().sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(entry => {
      const id = escapeHTML(entry.id);
      const assigned = (entry.performer_ids || []).map(pid => names[String(pid)] || ('Performeur #' + pid));
      const dateArea = String(entry.id) === String(editingId)
        ? '<div class="individual-o-history-edit"><input type="datetime-local" data-image-date="' + id + '" value="' + escapeHTML(toLocalDateTimeValue(entry.date)) + '"><button type="button" data-image-save="' + id + '">Enregistrer</button><button type="button" data-image-cancel>Annuler</button></div>'
        : '<div class="individual-o-history-date">' + escapeHTML(formatDate(entry.date)) + '</div>';
      const controls = String(entry.id) === String(editingId) ? '' : '<div class="individual-o-history-actions"><button type="button" class="individual-o-edit" data-image-edit="' + id + '">Modifier</button><button type="button" class="individual-o-delete" data-image-delete="' + id + '">Supprimer</button></div>';
      return '<div class="individual-o-history-row"><img class="individual-o-history-marker-thumb" src="/image/' + encodeURIComponent(imageId) + '/thumbnail" alt=""><div class="individual-o-history-main">' + dateArea + '<div class="individual-o-history-names">' + escapeHTML(assigned.join(', ')) + '</div></div>' + controls + '</div>';
    }).join('');
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toLocalDateTimeValue(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function parseLocalDateTime(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    // datetime-local is interpreted in the user's local timezone; persist ISO UTC.
    return date.toISOString();
  }

  function markerThumbnailHTML(entry, className) {
    if (!entry || !entry.marker_id) return '';
    const src = '/scene/' + encodeURIComponent(entry.scene_id || currentSceneId()) +
      '/scene_marker/' + encodeURIComponent(entry.marker_id) + '/screenshot';
    const markerTime = entry.marker_seconds == null ? entry.timestamp : entry.marker_seconds;
    const image = '<img class="' + className + '" src="' + escapeHTML(src) +
      '" loading="lazy" alt="Aperçu du marqueur Splooge" title="Cliquer pour accéder au marqueur à ' +
      escapeHTML(formatTimestamp(markerTime)) +
      '" onerror="this.classList.add(\'is-unavailable\');this.removeAttribute(\'src\');">';
    if (markerTime == null) return image;
    return '<button type="button" class="individual-o-marker-thumb-button" data-individual-o-marker-seek="' +
      escapeHTML(markerTime) + '" aria-label="Accéder au marqueur à ' +
      escapeHTML(formatTimestamp(markerTime)) + '">' + image + '</button>';
  }

  function renderHistory(history, names, editingId, sceneId) {
    if (!history.length) return '<p class="individual-o-empty">Aucun O individuel enregistré pour cette scène.</p>';
    return history.map(entry => {
      const assigned = (entry.performer_ids || []).map(id => names[String(id)] || ('Performeur #' + id));
      const id = escapeHTML(entry.id);
      const dateArea = String(entry.id) === String(editingId)
        ? '<div class="individual-o-date-editor"><label>Date et heure <input type="datetime-local" data-date-input="' + id + '" value="' + escapeHTML(toLocalDateTimeValue(entry.date)) + '"></label>' +
          '<label>Position vidéo (MM:SS ou HH:MM:SS) <input type="text" inputmode="numeric" placeholder="12:34" data-timestamp-input="' + id + '" value="' + escapeHTML(entry.timestamp == null ? '' : formatTimestamp(entry.timestamp)) + '"></label>' +
          '<div class="individual-o-date-actions"><button type="button" class="individual-o-date-save" data-save-date="' + id + '">Enregistrer</button>' +
          '<button type="button" class="individual-o-date-cancel" data-cancel-edit>Annuler</button></div></div>'
        : '<div class="individual-o-history-date">' + escapeHTML(formatDate(entry.date)) + '</div>' +
          (entry.timestamp == null ? '' : '<button type="button" class="individual-o-timestamp" data-seek-timestamp="' + escapeHTML(entry.timestamp) + '" title="Repositionner le lecteur Stash à ' + escapeHTML(formatTimestamp(entry.timestamp)) + '">▶ ' + escapeHTML(formatTimestamp(entry.timestamp)) + '</button>');
      const controls = String(entry.id) === String(editingId) ? ''
        : '<div class="individual-o-history-actions"><button type="button" class="individual-o-edit" data-edit-entry="' + id + '" title="Modifier la date, l’heure et la position vidéo">Modifier</button>' +
          '<button type="button" class="individual-o-delete" data-delete-entry="' + id + '" title="Supprimer cette entrée">Supprimer</button></div>';
      const thumbnail = markerThumbnailHTML(Object.assign({ scene_id: sceneId || currentSceneId() }, entry), 'individual-o-history-marker-thumb');
      return '<div class="individual-o-history-row">' + thumbnail + '<div class="individual-o-history-main">' + dateArea +
        '<div class="individual-o-history-names">' + escapeHTML(assigned.join(', ') || 'Aucun performeur') + '</div></div>' + controls + '</div>';
    }).join('');
  }


  // Global history page: isolated full-screen view; does not alter Stash's React page content.
  let globalHistoryCache = null;
  let globalHistoryLoading = false;
  let globalHistoryPromise = null;
  let globalHistoryOverlay = null;

  async function fetchAllIndividualHistory(force) {
    if (globalHistoryCache && !force) return globalHistoryCache;
    // Toute requête concurrente attend le même balayage complet. Ne jamais
    // renvoyer [] simplement parce qu'un autre écran charge déjà l'historique :
    // le tri des marqueurs dépend également de cette collecte.
    if (globalHistoryPromise) return globalHistoryPromise;
    globalHistoryLoading = true;
    const promise = (async () => {
      const all = [];
      try {
      const first = await gql(`query IndividualOGlobalCount {
        findScenes(filter: { per_page: 1, page: 1 }) { count scenes { id } }
      }`);
      const total = Number(first && first.findScenes && first.findScenes.count) || 0;
      const pageSize = 100;
      const pages = Math.ceil(total / pageSize);
      for (let page = 1; page <= pages; page++) {
        const data = await gql(`query IndividualOGlobalPage($page: Int!, $perPage: Int!) {
          findScenes(filter: { per_page: $perPage, page: $page }) {
            scenes {
              id title date custom_fields
              performers { id name }
              scene_markers { id title seconds }
            }
          }
        }`, { page, perPage: pageSize });
        const scenes = (data && data.findScenes && data.findScenes.scenes) || [];
        scenes.forEach(scene => {
          const raw = scene.custom_fields && scene.custom_fields[FIELD_KEY];
          if (!raw) return;
          let entries;
          try { entries = JSON.parse(raw); } catch (_) { return; }
          if (!Array.isArray(entries)) return;
          const performerMap = {};
          (scene.performers || []).forEach(p => performerMap[String(p.id)] = p.name);
          entries.forEach(entry => {
            const ids = Array.isArray(entry.performer_ids) ? entry.performer_ids : [];
            const names = ids.map(id => performerMap[String(id)] || ('Performeur #' + id));
            const marker = entry.marker_id
              ? (scene.scene_markers || []).find(m => String(m.id) === String(entry.marker_id))
              : null;
            all.push({
              id: String(entry.id), date: entry.date || '', timestamp: entry.timestamp,
              performer_ids: ids.map(String), performer_names: names,
              scene_id: String(scene.id), scene_title: scene.title || ('Scène #' + scene.id),
              scene_date: scene.date || '', marker_id: entry.marker_id || null,
              marker_title: marker ? (marker.title || 'Marqueur') : (entry.marker_title || ''),
              marker_seconds: marker ? marker.seconds : entry.marker_seconds,
              raw_entry: entry
            });
          });
        });
        if (globalHistoryOverlay && globalHistoryOverlay.isConnected) {
          const progress = globalHistoryOverlay.querySelector('[data-global-progress]');
          if (progress) progress.textContent = 'Analyse des scènes : ' + Math.min(page * pageSize, total) + ' / ' + total;
        }
      }
      all.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        globalHistoryCache = all;
        return all;
      } finally {
        globalHistoryLoading = false;
      }
    })();
    globalHistoryPromise = promise;
    try {
      return await promise;
    } finally {
      if (globalHistoryPromise === promise) globalHistoryPromise = null;
    }
  }

  // Recherche dédiée aux O enregistrés sur les images. Elle n'est appelée
  // que lorsque l'utilisateur ouvre l'onglet Images : aucun impact sur les tris scènes.
  async function fetchAllIndividualImageHistory() {
    const ids = await readIndividualImageIndex();
    const all = [];
    const pageSize = 4;
    for (let offset = 0; offset < ids.length; offset += pageSize) {
      const batch = ids.slice(offset, offset + pageSize);
      const results = await Promise.all(batch.map(async imageId => {
        try { return await loadImage(imageId); }
        catch (error) {
          console.warn('[Individual O] Image indexée inaccessible :', imageId, error);
          await updateIndividualImageIndex(imageId, false);
          return null;
        }
      }));
      results.forEach(result => {
        if (!result || !result.history.length) return;
        const image = result.image;
        const names = {};
        (image.performers || []).forEach(person => names[String(person.id)] = person.name);
        result.history.forEach(entry => {
          const idsForEntry = Array.isArray(entry.performer_ids) ? entry.performer_ids : [];
          all.push({
            id: String(entry.id), date: entry.date || '', performer_ids: idsForEntry.map(String),
            performer_names: idsForEntry.map(id => names[String(id)] || ('Performeur #' + id)),
            entity_type: 'image', image_id: String(image.id),
            image_title: image.title || ('Image #' + image.id),
            scene_title: image.title || ('Image #' + image.id), scene_id: null,
            marker_id: null, raw_entry: entry
          });
        });
      });
    }
    return all.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  function globalHistoryStylesAndShell() {
    if (globalHistoryOverlay) globalHistoryOverlay.remove();
    const overlay = document.createElement('div');
    overlay.id = 'individual-o-global-page';
    overlay.innerHTML = `
      <div class="io-global-shell">
        <header class="io-global-header">
          <div><div class="io-global-kicker">INDIVIDUAL O</div><h1>Historique des O individuels</h1>
          <div class="io-global-subtitle">Recherche transversale dans toutes les scènes et images de la bibliothèque</div></div>
          <button type="button" class="io-global-close" aria-label="Fermer">×</button>
        </header>
        <section class="io-global-filters">
          <label>Recherche performeur<input type="search" data-filter="performer" placeholder="Nom du performeur"></label>
          <label>Recherche scène ou image<input type="search" data-filter="scene" placeholder="Titre de la scène ou de l’image"></label>
          <label>Année<select data-filter="year"><option value="">Toutes les années</option></select></label>
          <label>Mois<select data-filter="month"><option value="">Tous les mois</option></select></label>
          <label>Du<input type="date" data-filter="from"></label>
          <label>Au<input type="date" data-filter="to"></label>
          <label>Ordre<select data-filter="sort"><option value="desc">Plus récents d’abord</option><option value="asc">Plus anciens d’abord</option><option value="marker_desc">Plus d’O associés d’abord</option><option value="marker_asc">Moins d’O associés d’abord</option></select></label>
          <button type="button" class="io-global-reset">Réinitialiser</button>
        </section>
        <div class="io-global-summary"><strong data-global-count>Chargement…</strong><span data-global-progress>Récupération des scènes…</span>
          <button type="button" class="io-global-refresh">Actualiser</button></div>
        <main class="io-global-results" data-global-results><div class="io-global-loading">Chargement de l’historique global…</div></main>
      </div>`;
    document.body.appendChild(overlay);
    globalHistoryOverlay = overlay;
    overlay.querySelector('.io-global-close').addEventListener('click', closeGlobalHistory);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeGlobalHistory(); });
    return overlay;
  }

  function closeGlobalHistory() {
    if (globalHistoryOverlay) globalHistoryOverlay.remove();
    globalHistoryOverlay = null;
  }

  function renderGlobalHistoryRows(entries) {
    const results = globalHistoryOverlay.querySelector('[data-global-results]');
    if (!entries.length) {
      results.innerHTML = '<div class="io-global-empty">Aucun O individuel ne correspond à ces filtres.</div>';
      return;
    }
    results.innerHTML = entries.map(entry => {
      const marker = entry.marker_id
        ? '<span class="io-global-marker">Marqueur ' + escapeHTML(entry.marker_title || 'associé') +
          (entry.marker_seconds != null ? ' · ' + escapeHTML(formatTimestamp(entry.marker_seconds)) : '') + '</span>'
        : '';
      const timestamp = entry.timestamp == null ? '' :
        '<span class="io-global-timecode">' + escapeHTML(formatTimestamp(entry.timestamp)) + '</span>';
      const isImage = entry.entity_type === 'image';
      const entityId = isImage ? entry.image_id : entry.scene_id;
      const entityPath = isImage ? '/images/' : '/scenes/';
      const entityLabel = isImage ? 'Image' : 'Scène';
      return '<article class="io-global-row" data-entry-id="' + escapeHTML(entry.id) + '" data-entity-type="' + (isImage ? 'image' : 'scene') + '" data-entity-id="' + escapeHTML(entityId) + '">' +
        '<div class="io-global-date">' + escapeHTML(formatDate(entry.date)) + '</div>' +
        (isImage ? '<img class="io-global-image-thumb" src="/image/' + encodeURIComponent(entityId) + '/thumbnail" alt="">' : '') +
        '<div class="io-global-main"><div class="io-global-performers">' + escapeHTML(entry.performer_names.join(', ') || 'Aucun performeur') + '</div>' +
        '<a class="io-global-scene" href="' + entityPath + encodeURIComponent(entityId) + '">' + entityLabel + ' · ' + escapeHTML(entry.scene_title) + '</a>' +
        '<div class="io-global-meta">' + timestamp + marker + '</div></div>' +
        '<div class="io-global-actions"><button type="button" data-edit-global="' + escapeHTML(entry.id) + '" data-entity-type="' + (isImage ? 'image' : 'scene') + '" data-entity-id="' + escapeHTML(entityId) + '">Modifier</button>' +
        '<button type="button" class="danger" data-delete-global="' + escapeHTML(entry.id) + '" data-entity-type="' + (isImage ? 'image' : 'scene') + '" data-entity-id="' + escapeHTML(entityId) + '">Supprimer</button></div></article>';
    }).join('');
    results.querySelectorAll('[data-edit-global]').forEach(button => button.addEventListener('click', () => button.dataset.entityType === 'image' ? editGlobalImageEntry(button.dataset.entityId, button.dataset.editGlobal) : editGlobalEntry(button.dataset.entityId, button.dataset.editGlobal)));
    results.querySelectorAll('[data-delete-global]').forEach(button => button.addEventListener('click', () => button.dataset.entityType === 'image' ? deleteGlobalImageEntry(button.dataset.entityId, button.dataset.deleteGlobal) : deleteGlobalEntry(button.dataset.entityId, button.dataset.deleteGlobal)));
  }

  function getGlobalFilteredEntries() {
    const controls = globalHistoryOverlay.querySelectorAll('[data-filter]');
    const values = {};
    controls.forEach(node => values[node.dataset.filter] = node.value.trim().toLocaleLowerCase());
    let entries = (globalHistoryCache || []).filter(entry => {
      const date = new Date(entry.date);
      if (values.performer && !entry.performer_names.join(' ').toLocaleLowerCase().includes(values.performer)) return false;
      if (values.scene && !entry.scene_title.toLocaleLowerCase().includes(values.scene)) return false;
      if (values.year && String(date.getFullYear()) !== values.year) return false;
      if (values.month && String(date.getMonth() + 1) !== values.month) return false;
      if (values.from && (!Number.isFinite(date.getTime()) || date < new Date(values.from + 'T00:00:00'))) return false;
      if (values.to && (!Number.isFinite(date.getTime()) || date > new Date(values.to + 'T23:59:59'))) return false;
      return true;
    });
    if (values.sort === 'marker_desc' || values.sort === 'marker_asc') {
      const markerCounts = new Map();
      (globalHistoryCache || []).forEach(entry => {
        if (!entry.marker_id) return;
        const key = String(entry.scene_id) + ':' + String(entry.marker_id);
        markerCounts.set(key, (markerCounts.get(key) || 0) + 1);
      });
      entries.sort((a, b) => {
        const countA = a.marker_id ? (markerCounts.get(String(a.scene_id) + ':' + String(a.marker_id)) || 0) : 0;
        const countB = b.marker_id ? (markerCounts.get(String(b.scene_id) + ':' + String(b.marker_id)) || 0) : 0;
        if (countA !== countB) return (countB - countA) * (values.sort === 'marker_desc' ? 1 : -1);
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
    } else {
      entries.sort((a,b) => (new Date(a.date).getTime() - new Date(b.date).getTime()) * (values.sort === 'asc' ? 1 : -1));
    }
    return entries;
  }

  function refreshGlobalHistoryView() {
    if (!globalHistoryOverlay || !globalHistoryCache) return;
    const entries = getGlobalFilteredEntries();
    globalHistoryOverlay.querySelector('[data-global-count]').textContent =
      entries.length + ' résultat(s) affiché(s) · ' + globalHistoryCache.length + ' au total';
    renderGlobalHistoryRows(entries);
  }

  async function editGlobalEntry(sceneId, entryId) {
    try {
      const fresh = await loadScene(sceneId);
      const entry = fresh.history.find(item => String(item.id) === String(entryId));
      if (!entry) throw new Error('Entrée introuvable dans cette scène.');
      const dateValue = toLocalDateTimeValue(entry.date);
      const dateInput = window.prompt('Date et heure (AAAA-MM-JJTHH:MM)', dateValue);
      if (dateInput === null) return;
      const parsedDate = parseLocalDateTime(dateInput);
      if (!parsedDate) { window.alert('Date ou heure invalide.'); return; }
      const timestampValue = entry.timestamp == null ? '' : formatTimestamp(entry.timestamp);
      const timestampInput = window.prompt('Position vidéo (MM:SS ou HH:MM:SS). Laisser vide pour supprimer.', timestampValue);
      if (timestampInput === null) return;
      const parsedTimestamp = timestampInput.trim() === '' ? null : parseTimestamp(timestampInput);
      if (timestampInput.trim() !== '' && parsedTimestamp === null) { window.alert('Position vidéo invalide.'); return; }
      entry.date = parsedDate;
      if (parsedTimestamp === null) delete entry.timestamp;
      else entry.timestamp = parsedTimestamp;
      await loadMarkerSettings();
      applyMarkerAssociation(entry, fresh.scene);
      await saveHistory(sceneId, fresh.history);
      performerHistoryCache.clear();
      markerCounterCache.clear();
      globalHistoryCache = null;
      const data = await fetchAllIndividualHistory(true);
      populateGlobalFilterOptions(data);
      refreshGlobalHistoryView();
    } catch (error) {
      window.alert('Impossible de modifier cette entrée : ' + error.message);
    }
  }

  async function deleteGlobalEntry(sceneId, entryId) {
    if (!(await confirmIndividualDelete())) return;
    try {
      const fresh = await loadScene(sceneId);
      const updated = fresh.history.filter(item => String(item.id) !== String(entryId));
      if (updated.length === fresh.history.length) throw new Error('Entrée introuvable.');
      await saveHistory(sceneId, updated);
      performerHistoryCache.clear();
      markerCounterCache.clear();
      globalHistoryCache = null;
      const data = await fetchAllIndividualHistory(true);
      populateGlobalFilterOptions(data);
      refreshGlobalHistoryView();
    } catch (error) {
      window.alert('Impossible de supprimer cette entrée : ' + error.message);
    }
  }

  async function editGlobalImageEntry(imageId, entryId) {
    try {
      const fresh = await loadImage(imageId); const entry = fresh.history.find(item => String(item.id) === String(entryId));
      if (!entry) throw new Error('Entrée introuvable dans cette image.');
      const value = window.prompt('Date et heure (AAAA-MM-JJTHH:MM)', toLocalDateTimeValue(entry.date));
      if (value === null) return; const date = parseLocalDateTime(value); if (!date) throw new Error('Date ou heure invalide.');
      entry.date = date; await saveImageHistory(imageId, fresh.history);
      const data = await fetchAllIndividualHistory(true); populateGlobalFilterOptions(data); refreshGlobalHistoryView();
    } catch (error) { window.alert('Impossible de modifier cette entrée : ' + error.message); }
  }

  async function deleteGlobalImageEntry(imageId, entryId) {
    if (!(await confirmIndividualDelete())) return;
    try {
      const fresh = await loadImage(imageId); const removed = fresh.history.find(item => String(item.id) === String(entryId));
      fresh.history = fresh.history.filter(item => String(item.id) !== String(entryId));
      await saveImageHistory(imageId, fresh.history); invalidatePerformerHistory(removed && removed.performer_ids || []);
      const data = await fetchAllIndividualHistory(true); populateGlobalFilterOptions(data); refreshGlobalHistoryView();
    } catch (error) { window.alert('Impossible de supprimer cet O : ' + error.message); }
  }

  function populateGlobalFilterOptions(entries) {
    if (!globalHistoryOverlay) return;
    const years = [...new Set(entries.map(e => new Date(e.date).getFullYear()).filter(y => Number.isFinite(y)))].sort((a,b) => b-a);
    const year = globalHistoryOverlay.querySelector('[data-filter="year"]');
    const month = globalHistoryOverlay.querySelector('[data-filter="month"]');
    const oldYear = year.value, oldMonth = month.value;
    year.innerHTML = '<option value="">Toutes les années</option>' + years.map(y => '<option value="' + y + '">' + y + '</option>').join('');
    year.value = oldYear;
    month.innerHTML = '<option value="">Tous les mois</option>' + ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((m,i) => '<option value="' + (i+1) + '">' + m + '</option>').join('');
    month.value = oldMonth;
  }

  async function openGlobalHistory() {
    const overlay = globalHistoryStylesAndShell();
    overlay.querySelector('.io-global-close').focus();
    overlay.querySelectorAll('[data-filter]').forEach(node => node.addEventListener('input', refreshGlobalHistoryView));
    overlay.querySelector('.io-global-reset').addEventListener('click', () => {
      overlay.querySelectorAll('[data-filter]').forEach(node => node.value = '');
      refreshGlobalHistoryView();
    });
    overlay.querySelector('.io-global-refresh').addEventListener('click', async () => {
      overlay.querySelector('[data-global-progress]').textContent = 'Actualisation…';
      try {
        globalHistoryCache = null;
        const entries = await fetchAllIndividualHistory(true);
        populateGlobalFilterOptions(entries);
        refreshGlobalHistoryView();
        overlay.querySelector('[data-global-progress]').textContent = 'Données actualisées';
      } catch (error) {
        overlay.querySelector('[data-global-results]').innerHTML = '<div class="io-global-error">' + escapeHTML(error.message) + '</div>';
      }
    });
    try {
      const entries = await fetchAllIndividualHistory(true);
      if (!overlay.isConnected) return;
      populateGlobalFilterOptions(entries);
      overlay.querySelector('[data-global-progress]').textContent = 'Bibliothèque analysée';
      refreshGlobalHistoryView();
    } catch (error) {
      overlay.querySelector('[data-global-progress]').textContent = 'Erreur de chargement';
      overlay.querySelector('[data-global-results]').innerHTML = '<div class="io-global-error">Erreur GraphQL : ' + escapeHTML(error.message) + '</div>';
    }
  }


  // Native Stash React route for the global history page.
  function registerGlobalHistoryRoute() {
    const api = window.PluginApi;
    if (!api || !api.register || typeof api.register.route !== 'function' || !api.React) return false;
    if (window.__individualOHistoryRouteRegistered) return true;
    const React = api.React;
    const h = React.createElement;

    function HistoryPage() {
      const [entries, setEntries] = React.useState([]);
      const [activeTab, setActiveTab] = React.useState('scenes');
      const [imageEntries, setImageEntries] = React.useState([]);
      const [imageLoading, setImageLoading] = React.useState(false);
      const [imageError, setImageError] = React.useState('');
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState('');
      const [performer, setPerformer] = React.useState('');
      const [selectedPerformerId, setSelectedPerformerId] = React.useState('');
      const [performerSuggestions, setPerformerSuggestions] = React.useState([]);
      const [performerSearching, setPerformerSearching] = React.useState(false);
      const [scene, setScene] = React.useState('');
      const [selectedSceneId, setSelectedSceneId] = React.useState('');
      const [sceneSuggestions, setSceneSuggestions] = React.useState([]);
      const [sceneSearching, setSceneSearching] = React.useState(false);
      const [year, setYear] = React.useState('');
      const [month, setMonth] = React.useState('');
      const [from, setFrom] = React.useState('');
      const [to, setTo] = React.useState('');
      const [sort, setSort] = React.useState('desc');
      const [refreshKey, setRefreshKey] = React.useState(0);
      const [busyId, setBusyId] = React.useState('');
      const [page, setPage] = React.useState(1);
      const [markerCardWidth, setMarkerCardWidth] = React.useState(() => {
        try {
          const saved = parseInt(localStorage.getItem('individual-o-history-card-width') || '260', 10);
          return Math.max(180, Math.min(500, Number.isFinite(saved) ? saved : 260));
        } catch (_) { return 260; }
      });
      React.useEffect(() => {
        try { localStorage.setItem('individual-o-history-card-width', String(markerCardWidth)); } catch (_) {}
      }, [markerCardWidth]);
      const [savedPageSize, setSavedPageSize] = React.useState(() => {
        try {
          const saved = JSON.parse(localStorage.getItem('individual-o-history-page-size') || 'null');
          return saved && typeof saved === 'object' ? saved : { mode: '20', custom: '30' };
        } catch (_) {
          return { mode: '20', custom: '30' };
        }
      });
      const pageSizeMode = savedPageSize.mode || '20';
      const customPageSize = savedPageSize.custom || '30';
      const setPageSizeMode = mode => setSavedPageSize(current => ({ ...current, mode }));
      const setCustomPageSize = custom => setSavedPageSize(current => ({ ...current, custom }));
      const pageSize = pageSizeMode === 'custom'
        ? Math.max(1, Math.min(500, parseInt(customPageSize, 10) || 20))
        : parseInt(pageSizeMode, 10) || 20;

      React.useEffect(() => {
        try {
          localStorage.setItem('individual-o-history-page-size', JSON.stringify({
            mode: pageSizeMode,
            custom: customPageSize
          }));
        } catch (_) {}      }, [pageSizeMode, customPageSize]);

      React.useEffect(() => {
        let cancelled = false;
        setLoading(true); setError('');
        fetchAllIndividualHistory(true).then(data => {
          if (!cancelled) setEntries(data);
        }).catch(err => {
          if (!cancelled) setError(err && err.message ? err.message : String(err));
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }, [refreshKey]);

      React.useEffect(() => {
        if (activeTab !== 'images') return undefined;
        let cancelled = false;
        setImageLoading(true); setImageError('');
        fetchAllIndividualImageHistory().then(data => {
          if (!cancelled) setImageEntries(data);
        }).catch(err => {
          if (!cancelled) setImageError(err && err.message ? err.message : String(err));
        }).finally(() => { if (!cancelled) setImageLoading(false); });
        return () => { cancelled = true; };
      }, [activeTab, refreshKey]);

      // Autocomplete is implemented in this React route (not the legacy overlay).
      React.useEffect(() => {
        if (selectedPerformerId || performer.trim().length < 2) {
          setPerformerSuggestions([]);
          setPerformerSearching(false);
          return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(async () => {
          setPerformerSearching(true);
          try {
            const result = await gql(`query IndividualOPerformerSuggestions($filter: FindFilterType) {
              findPerformers(filter: $filter) {
                performers { id name image_path }
              }
            }`, { filter: { q: performer.trim(), per_page: 20, page: 1 } });
            if (!cancelled) setPerformerSuggestions(
              result && result.findPerformers ? (result.findPerformers.performers || []) : []
            );
          } catch (err) {
            if (!cancelled) {
              console.warn('[Individual O] Recherche de performeurs impossible :', err);
              setPerformerSuggestions([]);
            }
          } finally {
            if (!cancelled) setPerformerSearching(false);
          }
        }, 250);
        return () => { cancelled = true; window.clearTimeout(timer); };
      }, [performer, selectedPerformerId]);

      // Scene autocomplete, using Stash's native scene search.
      React.useEffect(() => {
        if (activeTab !== 'scenes' || selectedSceneId || scene.trim().length < 2) {
          setSceneSuggestions([]);
          setSceneSearching(false);
          return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(async () => {
          setSceneSearching(true);
          try {
            const result = await gql(`query IndividualOSceneSuggestions($filter: FindFilterType) {
              findScenes(filter: $filter) {
                scenes { id title date paths { screenshot } }
              }
            }`, { filter: { q: scene.trim(), per_page: 20, page: 1 } });
            if (!cancelled) setSceneSuggestions(
              result && result.findScenes ? (result.findScenes.scenes || []) : []
            );
          } catch (err) {
            if (!cancelled) {
              console.warn('[Individual O] Recherche de scènes impossible :', err);
              setSceneSuggestions([]);
            }
          } finally {
            if (!cancelled) setSceneSearching(false);
          }
        }, 250);
        return () => { cancelled = true; window.clearTimeout(timer); };
      }, [scene, selectedSceneId, activeTab]);

      React.useEffect(() => { setPage(1); }, [
        activeTab, performer, selectedPerformerId, scene, selectedSceneId, year, month, from, to, sort, pageSize
      ]);

      const sourceEntries = activeTab === 'images' ? imageEntries : entries;
      const currentLoading = activeTab === 'images' ? imageLoading : loading;
      const currentError = activeTab === 'images' ? imageError : error;
      const filtered = sourceEntries.filter(entry => {
        const date = new Date(entry.date);
        if (selectedPerformerId && !(entry.performer_ids || []).some(id => String(id) === String(selectedPerformerId))) return false;
        if (!selectedPerformerId && performer && !entry.performer_names.join(' ').toLocaleLowerCase().includes(performer.toLocaleLowerCase())) return false;
        if (activeTab === 'scenes' && selectedSceneId && String(entry.scene_id) !== String(selectedSceneId)) return false;
        if ((!selectedSceneId || activeTab === 'images') && scene && !entry.scene_title.toLocaleLowerCase().includes(scene.toLocaleLowerCase())) return false;
        if (year && String(date.getFullYear()) !== year) return false;
        if (month && String(date.getMonth() + 1) !== month) return false;
        if (from && (!Number.isFinite(date.getTime()) || date < new Date(from + 'T00:00:00'))) return false;
        if (to && (!Number.isFinite(date.getTime()) || date > new Date(to + 'T23:59:59'))) return false;
        return true;
      });
      const markerCounts = new Map();
      (activeTab === 'images' ? [] : entries).forEach(entry => {
        if (!entry.marker_id) return;
        const key = String(entry.scene_id) + ':' + String(entry.marker_id);
        markerCounts.set(key, (markerCounts.get(key) || 0) + 1);
      });
      filtered.sort((a, b) => {
        if (sort === 'marker_desc' || sort === 'marker_asc') {
          const countA = a.marker_id ? (markerCounts.get(String(a.scene_id) + ':' + String(a.marker_id)) || 0) : 0;
          const countB = b.marker_id ? (markerCounts.get(String(b.scene_id) + ':' + String(b.marker_id)) || 0) : 0;
          if (countA !== countB) return (countB - countA) * (sort === 'marker_desc' ? 1 : -1);
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        }
        return (new Date(a.date).getTime() - new Date(b.date).getTime()) * (sort === 'asc' ? 1 : -1);
      });

      const years = [...new Set(sourceEntries.map(e => new Date(e.date).getFullYear()).filter(y => Number.isFinite(y)))].sort((a,b) => b-a);
      const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

      async function editEntry(entry) {
        setBusyId(entry.id);
        try {
          const fresh = await loadScene(entry.scene_id);
          const item = fresh.history.find(v => String(v.id) === String(entry.id));
          if (!item) throw new Error('Entrée introuvable.');
          const dateInput = window.prompt('Date et heure (AAAA-MM-JJTHH:MM)', toLocalDateTimeValue(item.date));
          if (dateInput === null) return;
          const parsedDate = parseLocalDateTime(dateInput);
          if (!parsedDate) { window.alert('Date ou heure invalide.'); return; }
          const oldTime = item.timestamp == null ? '' : formatTimestamp(item.timestamp);
          const timeInput = window.prompt('Position vidéo (MM:SS ou HH:MM:SS). Vide pour supprimer.', oldTime);
          if (timeInput === null) return;
          const parsedTime = timeInput.trim() === '' ? null : parseTimestamp(timeInput);
          if (timeInput.trim() && parsedTime === null) { window.alert('Position vidéo invalide.'); return; }
          item.date = parsedDate;
          if (parsedTime === null) delete item.timestamp; else item.timestamp = parsedTime;
          await loadMarkerSettings();
          applyMarkerAssociation(item, fresh.scene);
          await saveHistory(entry.scene_id, fresh.history);
          performerHistoryCache.clear(); markerCounterCache.clear(); globalHistoryCache = null;
          setRefreshKey(v => v + 1);
        } catch (err) { window.alert('Modification impossible : ' + err.message); }
        finally { setBusyId(''); }
      }

      async function deleteEntry(entry) {
        if (!(await confirmIndividualDelete())) return;
        setBusyId(entry.id);
        try {
          const fresh = await loadScene(entry.scene_id);
          const updated = fresh.history.filter(v => String(v.id) !== String(entry.id));
          if (updated.length === fresh.history.length) throw new Error('Entrée introuvable.');
          await saveHistory(entry.scene_id, updated);
          performerHistoryCache.clear(); markerCounterCache.clear(); globalHistoryCache = null;
          setRefreshKey(v => v + 1);
        } catch (err) { window.alert('Suppression impossible : ' + err.message); }
        finally { setBusyId(''); }
      }

      async function editImageEntry(entry) {
        setBusyId(entry.id);
        try {
          const fresh = await loadImage(entry.image_id);
          const item = fresh.history.find(v => String(v.id) === String(entry.id));
          if (!item) throw new Error('Entrée introuvable dans cette image.');
          const dateInput = window.prompt('Date et heure (AAAA-MM-JJTHH:MM)', toLocalDateTimeValue(item.date));
          if (dateInput === null) return;
          const parsedDate = parseLocalDateTime(dateInput);
          if (!parsedDate) throw new Error('Date ou heure invalide.');
          item.date = parsedDate;
          await saveImageHistory(entry.image_id, fresh.history);
          invalidatePerformerHistory(item.performer_ids || []);
          setRefreshKey(v => v + 1);
        } catch (err) { window.alert('Modification impossible : ' + err.message); }
        finally { setBusyId(''); }
      }

      async function deleteImageEntry(entry) {
        if (!(await confirmIndividualDelete('Cette entrée appartient à l’historique d’une image.'))) return;
        setBusyId(entry.id);
        try {
          const fresh = await loadImage(entry.image_id);
          const updated = fresh.history.filter(v => String(v.id) !== String(entry.id));
          if (updated.length === fresh.history.length) throw new Error('Entrée introuvable.');
          await saveImageHistory(entry.image_id, updated);
          invalidatePerformerHistory(entry.performer_ids || []);
          setRefreshKey(v => v + 1);
        } catch (err) { window.alert('Suppression impossible : ' + err.message); }
        finally { setBusyId(''); }
      }

      const input = (label, value, setter, type='search', placeholder='') =>
        h('div', { className: 'form-group io-native-filter' },
          h('label', { className: 'form-label' }, label),
          h('input', { className: 'form-control', type, value, placeholder, onChange: e => setter(e.target.value) }));
      const select = (label, value, setter, options) =>
        h('div', { className: 'form-group io-native-filter' },
          h('label', { className: 'form-label' }, label),
          h('select', { className: 'form-control', value, onChange: e => setter(e.target.value) },
            options.map(opt => h('option', { key: opt.value, value: opt.value }, opt.label))));

      const groupedMarkerSort = activeTab === 'scenes' && (sort === 'marker_desc' || sort === 'marker_asc');
      const displayEntries = groupedMarkerSort ? (() => {
        const groups = new Map();
        const singles = [];
        filtered.forEach(entry => {
          if (!entry.marker_id) { singles.push({ key: 'entry:' + entry.scene_id + ':' + entry.id, entry, entries: [entry] }); return; }
          const key = 'marker:' + entry.scene_id + ':' + entry.marker_id;
          if (!groups.has(key)) groups.set(key, { key, entry, entries: [] });
          groups.get(key).entries.push(entry);
        });
        const combined = [...groups.values(), ...singles];
        combined.forEach(group => {
          group.entries.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          group.entry = group.entries[0];
          group.count = group.entries.length;
        });
        combined.sort((a,b) => {
          if (a.count !== b.count) return (b.count - a.count) * (sort === 'marker_desc' ? 1 : -1);
          return new Date(b.entry.date).getTime() - new Date(a.entry.date).getTime();
        });
        return combined;
      })() : filtered.map(entry => ({ key: 'entry:' + entry.scene_id + ':' + entry.id, entry, entries: [entry], count: 1 }));
      const pageCount = Math.max(1, Math.ceil(displayEntries.length / pageSize));
      const safePage = Math.min(page, pageCount);
      const pagedEntries = displayEntries.slice((safePage - 1) * pageSize, safePage * pageSize);
      const pageKey = pagedEntries.map(group => group.key).join('|');

      // Ne charge les flux vidéo que lorsque les cartes approchent de la zone visible.
      // Cela évite de lancer simultanément des dizaines de flux sur une même page.
      React.useEffect(() => {
        const videos = Array.from(document.querySelectorAll('.io-native-dynamic-thumb[data-preview-src]'));
        if (!videos.length) return undefined;

        const activate = video => {
          if (!video.dataset.previewLoaded) {
            video.dataset.previewLoaded = '1';
            video.src = video.dataset.previewSrc;
            video.load();
          }
          const play = () => {
            if (video.dataset.previewFailed) return;
            const promise = video.play();
            if (promise && typeof promise.catch === 'function') promise.catch(() => {});
          };
          if (video.readyState >= 2) play();
          else video.addEventListener('loadeddata', play, { once: true });
        };

        if (!('IntersectionObserver' in window)) {
          videos.forEach(activate);
          return undefined;
        }
        const observer = new IntersectionObserver(items => {
          items.forEach(item => {
            const video = item.target;
            if (item.isIntersecting) activate(video);
            else if (video.dataset.previewLoaded && !video.paused) video.pause();
          });
        }, { root: null, rootMargin: '250px 0px', threshold: 0.01 });
        videos.forEach(video => observer.observe(video));
        return () => observer.disconnect();
      }, [pageKey]);

      const rows = pagedEntries.map(group => {
        const entry = group.entry;
        if (activeTab === 'images') {
          const imageUrl = '/images/' + encodeURIComponent(entry.image_id);
          return h('article', { className: 'io-native-result', key: 'image:' + entry.image_id + ':' + entry.id },
            h(window.PluginApi.libraries.ReactRouterDOM.Link, { className: 'io-native-thumb-link', to: imageUrl, title: 'Ouvrir l’image' },
              h('img', { className: 'io-native-thumb', src: '/image/' + encodeURIComponent(entry.image_id) + '/thumbnail', alt: '', loading: 'lazy' })),
            h('div', { className: 'io-native-result-content' },
              h('div', { className: 'io-native-result-performers' }, entry.performer_names.join(', ') || 'Aucun performeur'),
              h(window.PluginApi.libraries.ReactRouterDOM.Link, { className: 'io-native-scene-link', to: imageUrl }, entry.image_title),
              h('div', { className: 'io-native-result-meta' }, h('span', null, formatDate(entry.date)), h('span', null, 'Image'))));
        }
        const groupedEntries = group.entries;
        const markerImage = entry.marker_id
          ? '/scene/' + encodeURIComponent(entry.scene_id) + '/scene_marker/' + encodeURIComponent(entry.marker_id) + '/screenshot'
          : '';
        const markerLabel = entry.marker_id ? (entry.marker_title || 'Marqueur associé') : 'Aucun marqueur associé';
        const sceneUrl = '/scenes/' + encodeURIComponent(entry.scene_id) +
          (entry.timestamp != null ? '?t=' + Math.floor(entry.timestamp) : '');
        return h('article', { className: 'io-native-result', key: entry.scene_id + ':' + entry.id },
          h(window.PluginApi.libraries.ReactRouterDOM.Link, { className: 'io-native-thumb-link individual-o-marker-preview-host', to: sceneUrl, title: 'Ouvrir la scène au moment enregistré', style: { position: 'relative' } },
            markerImage
              ? h('video', {
                  className: 'io-native-thumb io-native-dynamic-thumb',
                  'data-preview-src': '/scene/' + encodeURIComponent(entry.scene_id) + '/scene_marker/' + encodeURIComponent(entry.marker_id) + '/stream',
                  poster: markerImage,
                  muted: true,
                  defaultMuted: true,
                  playsInline: true,
                  autoPlay: true,
                  preload: 'auto',
                  loop: true,
                  // Start every marker preview automatically when the result
                  // card is rendered; muted playback is allowed by browsers.
                  onLoadedData: e => {
                    const video = e.currentTarget;
                    if (!video.dataset.previewFailed) {
                      const promise = video.play();
                      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
                    }
                  },
                  onError: e => {
                    const video = e.currentTarget;
                    if (video.dataset.previewFailed) return;
                    video.dataset.previewFailed = '1';
                    video.removeAttribute('src');
                    video.load();
                    const image = document.createElement('img');
                    image.className = 'io-native-thumb';
                    image.src = markerImage;
                    image.alt = markerLabel;
                    image.loading = 'lazy';
                    video.replaceWith(image);
                  }
                })
              : h('div', { className: 'io-native-thumb-placeholder' }, 'O')),
          h('div', { className: 'io-native-result-content' },
            h('div', { className: 'io-native-result-performers' }, entry.performer_names.join(', ') || 'Aucun performeur'),
            h(window.PluginApi.libraries.ReactRouterDOM.Link, { className: 'io-native-scene-link', to: sceneUrl }, entry.scene_title),
            h('div', { className: 'io-native-result-meta' },
              h('span', null, formatDate(entry.date)),
              entry.timestamp == null ? null : h('span', { className: 'io-native-time-label' }, '▶ ' + formatTimestamp(entry.timestamp)),
              entry.marker_id ? h('span', {
                className: 'io-native-marker-label',
                title: groupedMarkerSort
                  ? group.count + ' O individuel(s) associé(s) à ce marqueur'
                  : markerLabel
              }, groupedMarkerSort ? markerLabel + ' · ' + group.count : markerLabel) : null)));
      });
      // Render the autocomplete menu in viewport coordinates so it is not
      // clipped by the filter card or any Stash ancestor with overflow hidden.
      const performerInput = document.querySelector('.io-native-performer-filter input');
      const performerRect = performerInput && performerInput.getBoundingClientRect();
      const performerMenuStyle = performerRect ? {
        position: 'fixed',
        top: (performerRect.bottom + 3) + 'px',
        left: performerRect.left + 'px',
        width: performerRect.width + 'px',
        maxHeight: Math.max(120, window.innerHeight - performerRect.bottom - 16) + 'px'
      } : {};
      const sceneInput = document.querySelector('.io-native-scene-filter input');
      const sceneRect = sceneInput && sceneInput.getBoundingClientRect();
      const sceneMenuStyle = sceneRect ? {
        position: 'fixed',
        top: (sceneRect.bottom + 3) + 'px',
        left: sceneRect.left + 'px',
        width: sceneRect.width + 'px',
        maxHeight: Math.max(120, window.innerHeight - sceneRect.bottom - 16) + 'px'
      } : {};

      return h('div', { className: 'container-fluid io-native-page' },
        h('div', { className: 'row align-items-center mb-3' },
          h('div', { className: 'col' },
            h('h2', { className: 'mb-1' }, 'Historique des O individuels'),
            h('div', { className: 'text-muted' }, activeTab === 'scenes' ? 'Historique des O individuels enregistrés sur les scènes.' : 'Historique des O individuels enregistrés uniquement sur les images.')),
          h('div', { className: 'col-auto' },
            h('button', { className: 'btn btn-secondary', disabled: currentLoading, onClick: () => setRefreshKey(v => v + 1) }, 'Actualiser'))),
        h('div', { className: 'io-history-tabs nav nav-tabs mb-3', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', 'aria-selected': activeTab === 'scenes', className: 'nav-link' + (activeTab === 'scenes' ? ' active' : ''), onClick: () => { setActiveTab('scenes'); setScene(''); setSelectedSceneId(''); } }, 'Scènes'),
          h('button', { type: 'button', role: 'tab', 'aria-selected': activeTab === 'images', className: 'nav-link' + (activeTab === 'images' ? ' active' : ''), onClick: () => { setActiveTab('images'); setScene(''); setSelectedSceneId(''); } }, 'Images')),
        h('div', { className: 'card mb-3' },
          h('div', { className: 'card-body io-native-filter-grid' },
            h('div', { className: 'form-group io-native-filter io-native-performer-filter' },
              h('label', { className: 'form-label' }, 'Performeur'),
              h('div', { className: 'io-native-performer-autocomplete' },
                h('input', {
                  className: 'form-control', type: 'search', value: performer,
                  placeholder: 'Nom du performeur', autoComplete: 'off',
                  onChange: e => { setPerformer(e.target.value); setSelectedPerformerId(''); },
                  onBlur: () => window.setTimeout(() => setPerformerSuggestions([]), 120),
                  onKeyDown: e => { if (e.key === 'Escape') setPerformerSuggestions([]); }
                }),
                performerSearching ? h('div', { className: 'io-native-performer-status' }, 'Recherche…') : null,
                performerSuggestions.length ? h('div', { className: 'io-native-performer-suggestions', style: performerMenuStyle },
                  performerSuggestions.map(person => h('button', {
                    type: 'button', key: person.id, className: 'io-native-performer-option',
                    onMouseDown: e => e.preventDefault(),
                    onClick: () => {
                      setPerformer(person.name);
                      setSelectedPerformerId(String(person.id));
                      setPerformerSuggestions([]);
                    }
                  },
                    h('img', {
                      src: person.image_path || ('/performer/' + encodeURIComponent(person.id) + '/image'),
                      alt: '', loading: 'lazy',
                      onError: e => { e.currentTarget.style.visibility = 'hidden'; }
                    }),
                    h('span', null, person.name)
                  ))) : null
              )),
            h('div', { className: 'form-group io-native-filter io-native-scene-filter' },
              h('label', { className: 'form-label' }, activeTab === 'images' ? 'Image' : 'Scène'),
              h('div', { className: 'io-native-performer-autocomplete' },
                h('input', {
                  className: 'form-control', type: 'search', value: scene,
                  placeholder: activeTab === 'images' ? 'Titre de l’image' : 'Titre de la scène', autoComplete: 'off',
                  onChange: e => { setScene(e.target.value); setSelectedSceneId(''); },
                  onBlur: () => window.setTimeout(() => setSceneSuggestions([]), 120),
                  onKeyDown: e => { if (e.key === 'Escape') setSceneSuggestions([]); }
                }),
                sceneSearching ? h('div', { className: 'io-native-performer-status' }, 'Recherche…') : null,
                activeTab === 'scenes' && sceneSuggestions.length ? h('div', { className: 'io-native-performer-suggestions io-native-scene-suggestions', style: sceneMenuStyle },
                  sceneSuggestions.map(item => h('button', {
                    type: 'button', key: item.id, className: 'io-native-performer-option io-native-scene-option',
                    onMouseDown: e => e.preventDefault(),
                    onClick: () => {
                      setScene(item.title || ('Scène #' + item.id));
                      setSelectedSceneId(String(item.id));
                      setSceneSuggestions([]);
                    }
                  },
                    h('img', {
                      src: item.paths && item.paths.screenshot ? item.paths.screenshot : ('/scene/' + encodeURIComponent(item.id) + '/screenshot'),
                      alt: '', loading: 'lazy',
                      onError: e => { e.currentTarget.style.visibility = 'hidden'; }
                    }),
                    h('span', null,
                      h('strong', null, item.title || ('Scène #' + item.id)),
                      h('small', null, 'Scène #' + item.id + (item.date ? ' · ' + item.date : ''))
                    )
                  ))) : null
              )),
            select('Année', year, setYear, [{value:'',label:'Toutes les années'}, ...years.map(y => ({value:String(y),label:String(y)}))]),
            select('Mois', month, setMonth, [{value:'',label:'Tous les mois'}, ...monthNames.map((m,i) => ({value:String(i+1),label:m}))]),
            input('Du', from, setFrom, 'date'),
            input('Au', to, setTo, 'date'),
            select('Ordre', sort, setSort, [{value:'desc',label:'Plus récents d’abord'},{value:'asc',label:'Plus anciens d’abord'},{value:'marker_desc',label:'Plus d’O associés d’abord'},{value:'marker_asc',label:'Moins d’O associés d’abord'}]),
            h('div', { className: 'io-native-reset-wrap' },
              h('button', { className: 'btn btn-secondary', onClick: () => { setPerformer('');setSelectedPerformerId('');setPerformerSuggestions([]);setScene('');setSelectedSceneId('');setSceneSuggestions([]);setYear('');setMonth('');setFrom('');setTo('');setSort('desc'); } }, 'Réinitialiser')))),
        h('div', { className: 'io-native-results-toolbar' },
          h('div', { className: 'io-native-count' }, currentLoading ? 'Chargement de la bibliothèque…' :
            displayEntries.length + (ioIsFrench ? ' carte(s) · page ' : ' card(s) · page ') + safePage + ' / ' + pageCount + ' · ' + filtered.length + (ioIsFrench ? ' O individuel(s) filtré(s)' : ' individual O(s) filtered')),
          !currentLoading && displayEntries.length > 0 ? h('nav', { className: 'io-native-pagination io-native-pagination-top', 'aria-label': 'Pagination historique — haut' },
            h('button', { className: 'btn btn-secondary', disabled: safePage <= 1, onClick: () => setPage(1) }, '«'),
            h('button', { className: 'btn btn-secondary', disabled: safePage <= 1, onClick: () => setPage(v => Math.max(1, v - 1)) }, '‹'),
            h('span', null, ioIsFrench ? 'Page ' + safePage + ' sur ' + pageCount : 'Page ' + safePage + ' of ' + pageCount),
            h('button', { className: 'btn btn-secondary', disabled: safePage >= pageCount, onClick: () => setPage(v => Math.min(pageCount, v + 1)) }, '›'),
            h('button', { className: 'btn btn-secondary', disabled: safePage >= pageCount, onClick: () => setPage(pageCount) }, '»')) : null,
          h('div', { className: 'io-native-page-size' },
            h('label', null, 'Résultats par page'),
            h('select', { className: 'form-control', value: pageSizeMode, onChange: e => setPageSizeMode(e.target.value) },
              h('option', { value: '10' }, '10'), h('option', { value: '20' }, '20'),
              h('option', { value: '50' }, '50'), h('option', { value: 'custom' }, 'Personnalisé')),
            pageSizeMode === 'custom' ? h('input', { className: 'form-control io-native-custom-size', type: 'number',
              min: '1', max: '500', value: customPageSize, onChange: e => setCustomPageSize(e.target.value),
              'aria-label': 'Nombre personnalisé de résultats par page' }) : null),
          h('div', { className: 'io-native-card-size-control' },
            h('label', { htmlFor: 'io-native-card-width' }, 'Taille des marqueurs'),
            h('input', {
              id: 'io-native-card-width', type: 'range', min: '180', max: '500', step: '10',
              value: markerCardWidth,
              onChange: e => setMarkerCardWidth(parseInt(e.target.value, 10) || 260),
              'aria-label': 'Largeur des cartes de marqueurs'
            }),
            h('span', null, markerCardWidth + ' px'))),
        currentError ? h('div', { className: 'alert alert-danger' }, 'Erreur de chargement : ' + currentError) : null,
        !currentLoading && !currentError && !filtered.length ? h('div', { className: 'text-muted py-4' }, 'Aucun O individuel ne correspond à ces filtres.') : null,
        h('div', {
          className: 'io-native-results',
          style: { gridTemplateColumns: 'repeat(auto-fill, minmax(' + markerCardWidth + 'px, 1fr))' }
        }, rows),
        !currentLoading && displayEntries.length > 0 ? h('nav', { className: 'io-native-pagination', 'aria-label': 'Pagination historique' },
          h('button', { className: 'btn btn-secondary', disabled: safePage <= 1, onClick: () => setPage(1) }, '«'),
          h('button', { className: 'btn btn-secondary', disabled: safePage <= 1, onClick: () => setPage(v => Math.max(1, v - 1)) }, '‹'),
          h('span', null, ioIsFrench ? 'Page ' + safePage + ' sur ' + pageCount : 'Page ' + safePage + ' of ' + pageCount),
          h('button', { className: 'btn btn-secondary', disabled: safePage >= pageCount, onClick: () => setPage(v => Math.min(pageCount, v + 1)) }, '›'),
          h('button', { className: 'btn btn-secondary', disabled: safePage >= pageCount, onClick: () => setPage(pageCount) }, '»')) : null);
    }

    api.register.route('/plugin/individual-o/history', HistoryPage);
    window.__individualOHistoryRouteRegistered = true;
    return true;
  }

  function installGlobalHistoryLauncher() {
    if (document.getElementById('individual-o-global-nav')) return;
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const reference = anchors.find(a => /\/scenes\/?$/i.test(a.getAttribute('href') || '') ||
      /\/performers\/?$/i.test(a.getAttribute('href') || ''));
    if (!reference || !reference.parentElement) return;

    const item = reference.parentElement.cloneNode(true);
    item.id = 'individual-o-global-nav';
    // Do not inherit the active/focused appearance of the Stash navigation item.
    item.classList.remove('active', 'show', 'focus');
    item.querySelectorAll('.active, .show, .focus').forEach(node => {
      node.classList.remove('active', 'show', 'focus');
    });
    const link = item.querySelector('a') || item;
    link.href = '/?individual-o-history=1';
    link.removeAttribute('target');
    link.removeAttribute('aria-current');
    link.removeAttribute('aria-selected');
    link.classList.remove('active', 'show', 'focus');
    link.blur();
    link.innerHTML = individualOIconHTML('individual-o-nav-icon') + '<span>Historique O individuel</span>';
    link.addEventListener('click', event => {
      event.preventDefault();
      const targetPath = '/plugin/individual-o/history';
      window.history.pushState({ individualOHistory: true }, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate', { state: { individualOHistory: true } }));
    });
    const navContainer = reference.closest('.navbar-nav') || reference.parentElement.parentElement;
    if (!navContainer) return;
    navContainer.classList.add('individual-o-nav-container');
    // Append after every existing navigation item; CSS makes this item flush-right.
    navContainer.appendChild(item);
  }


  // Lightweight runtime localization: French follows Stash; every other locale uses English.
  const IO_TRANSLATIONS_EN = {"Enregistrer un O individuel":"Record an individual O","Enregistrer un O pour un ou plusieurs performeurs de cette scène":"Record an O for one or more performers in this scene","Historique d’O individuel":"Individual O history","Historique individuel":"Individual History","Historique des O individuels":"Individual O history","Historique des O individuels enregistrés sur les scènes.":"Individual O history recorded on scenes.","Historique des O individuels enregistrés uniquement sur les images.":"Individual O history recorded on images only.","Historique de cette scène ":"History for this scene ","Historique de cette image ":"History for this image ","Historique O individuel":"Individual O history","Scènes":"Scenes","Images":"Images","Actualiser":"Refresh","Performeur":"Performer","Nom du performeur":"Performer name","Titre de la scène ou de l’image":"Scene or image title","Titre de l’image":"Image title","Titre de la scène":"Scene title","Année":"Year","Plus récents d’abord":"Newest first","Plus anciens d’abord":"Oldest first","Plus d’O associés d’abord":"Most associated O first","Moins d’O associés d’abord":"Fewest associated O first","Chargement de la bibliothèque…":"Loading library…","Recherche…":"Searching…","Aucun performeur":"No performer","Aucun O individuel enregistré.":"No individual O recorded.","Aucun O individuel enregistré pour cette scène.":"No individual O recorded for this scene.","Aucun O individuel ne correspond à ces filtres.":"No individual O matches these filters.","Aucun marqueur associé":"No marker associated","Marqueur associé":"Associated marker","Marqueur":"Marker","Scène":"Scene","Image":"Image","O individuel":"Individual O","Modifier":"Edit","Supprimer":"Delete","Enregistrer":"Save","Annuler":"Cancel","Fermer":"Close","Réinitialiser":"Reset","Créer le marqueur et l’O":"Create marker and O","Enregistrer sans marqueur":"Save without marker","Enregistrement…":"Saving…","Date de l’O individuel":"Individual O date","Maintenant (date et heure actuelles)":"Now (current date and time)","Tu peux réutiliser un O classique pour plusieurs attributions individuelles.":"You can reuse a classic O for multiple individual assignments.","Aucun O classique enregistré dans cette scène.":"No classic O recorded in this scene.","À qui attribuer ce O ?":"Who should this O be assigned to?","Sélectionne au moins un performeur.":"Select at least one performer.","Comment veux-tu enregistrer cet O individuel ?":"How would you like to record this individual O?","La date de l’O classique sélectionné est invalide.":"The selected classic O date is invalid.","Le marqueur sélectionné est introuvable. Recharge la fenêtre.":"The selected marker could not be found. Reload the dialog.","Impossible de récupérer la position actuelle de la vidéo. Aucun marqueur n’a été créé.":"Could not retrieve the current video position. No marker was created.","O individuel et O classique enregistrés à la même date et heure.":"Individual O and classic O recorded at the same date and time.","Échec de l’enregistrement.":"Save failed.","Date ou heure invalide.":"Invalid date or time.","Position vidéo invalide.":"Invalid video position.","Date, heure ou position vidéo invalide. Utilise MM:SS ou HH:MM:SS pour la position.":"Invalid date, time, or video position. Use MM:SS or HH:MM:SS for the position.","Cette entrée n’existe plus. Recharge la fenêtre.":"This entry no longer exists. Reload the dialog.","Entrée introuvable.":"Entry not found.","Entrée introuvable dans cette scène.":"Entry not found in this scene.","Entrée introuvable dans cette image.":"Entry not found in this image.","Date et heure":"Date and time","Position vidéo (MM:SS ou HH:MM:SS)":"Video position (MM:SS or HH:MM:SS)","Position vidéo (MM:SS ou HH:MM:SS). Laisser vide pour supprimer.":"Video position (MM:SS or HH:MM:SS). Leave blank to remove.","Position vidéo (MM:SS ou HH:MM:SS). Vide pour supprimer.":"Video position (MM:SS or HH:MM:SS). Leave blank to remove.","Mois":"Month","Du":"From","Au":"To","Toutes les années":"All years","Tous les mois": "All months","Janvier":"January","Février":"February","Mars":"March","Avril":"April","Mai":"May","Juin":"June","Juillet":"July","Août":"August","Septembre":"September","Octobre":"October","Novembre":"November","Décembre":"December","Données actualisées":"Data refreshed","Ordre":"Sort order","Bibliothèque analysée":"Library scanned","Résultats par page":"Results per page","Personnalisé":"Custom","Nombre personnalisé de résultats par page":"Custom number of results per page","Taille des marqueurs":"Marker size","Largeur des cartes de marqueurs":"Marker card width","Pagination historique":"History pagination","Pagination historique — haut":"History pagination — top","Page ":"Page "," sur ":" of ","O individuel(s) filtré(s)":"filtered individual O"," résultat(s) affiché(s) · ":" result(s) displayed · ","O individuel(s) associé(s) à ce marqueur":"individual O associated with this marker","attribution(s) O individuel associée(s) à ce marqueur":"individual O assignment(s) associated with this marker","Consulter l’historique des O individuels":"View individual O history","O individuel enregistré, mais la création de l’O classique a échoué : ":"Individual O recorded, but classic O creation failed: ","O individuel enregistré. La synchronisation du O classique est désactivée dans les paramètres.":"Individual O recorded. Classic O synchronization is disabled in settings.","O individuel enregistré et compteur O classique de l’image incrémenté.":"Individual O recorded and the image classic O counter incremented.","O individuel enregistré, mais l’incrémentation du O classique a échoué : ":"Individual O recorded, but classic O increment failed: ","Aperçu du marqueur Splooge":"Splooge marker preview","O individuel enregistré sans marqueur Splooge associé.":"Individual O recorded without an associated Splooge marker.","Marqueur Splooge : ":"Splooge marker: ","O enregistré et associé au marqueur Splooge (":"O recorded and associated with the Splooge marker (","Supprimer cet O individuel ?":"Delete this individual O?","Cette entrée sera supprimée définitivement de l’historique.":"This entry will be permanently deleted from the history.","Modifier cet O individuel":"Edit this individual O","Supprimer cet O individuel":"Delete this individual O","Modifier la date, l’heure et la position vidéo":"Edit date, time, and video position","Supprimer cette entrée":"Delete this entry","Ouvrir l’image":"Open image","Ouvrir la scène au moment enregistré":"Open scene at recorded time","Date et heure (AAAA-MM-JJTHH:MM)":"Date and time (YYYY-MM-DDTHH:MM)","Erreur de chargement : ":"Loading error: ","Impossible de charger la scène : ":"Unable to load scene: ","Impossible de charger l’image : ":"Unable to load image: ","Impossible de modifier cette entrée : ":"Unable to edit this entry: ","Impossible de supprimer cette entrée : ":"Unable to delete this entry: ","Impossible de modifier la date : ":"Unable to edit the date: ","Impossible de supprimer cet O : ":"Unable to delete this O: ","Impossible de repositionner la vidéo : ":"Unable to seek video: ","Lecteur vidéo introuvable sur cette page.":"Video player not found on this page.","Titre du marqueur créé automatiquement":"Automatically created marker title","Étiquette principale du marqueur créé":"Primary tag for the created marker","Masquer les boutons Modifier / Supprimer":"Hide Edit / Delete buttons","Créer automatiquement un O classique sur les scènes":"Automatically create a classic O on scenes","Créer automatiquement un O classique sur les images":"Automatically create a classic O on images","Masquer le compteur individuel":"Hide individual counter","Masquer les compteurs des historiques latéraux et des marqueurs Splooge":"Hide counters in side histories and Splooge markers","Masquer les compteurs O classiques des performeurs":"Hide performers’ classic O counters","Proposer la création automatique d’un marqueur":"Offer automatic marker creation","Le tag doit déjà exister dans Stash. Saisis son nom exactement à l’identique (majuscules, accents et espaces compris) : il sera associé au marqueur créé automatiquement. Obligatoire : aucun tag prérempli.":"The tag must already exist in Stash. Enter its name exactly as it appears (including capitalization, accents, and spaces); it will be associated with the automatically created marker. Required: no default tag.","Enregistre les O individuels et synchronise la création automatique des O classiques natifs Stash.":"Records individual O entries and synchronizes the automatic creation of native Stash classic O entries.","Masque les boutons de modification et de suppression dans les historiques latéraux des scènes et des images. Désactivé par défaut : les boutons restent visibles.":"Hides the edit and delete buttons in scene and image side histories. Off by default: buttons remain visible.","Lorsque cette option est activée, un O classique natif Stash est créé en même temps qu’un O individuel enregistré avec la date et l’heure actuelles. Désactivée, seul l’O individuel est enregistré.":"When enabled, a native Stash classic O is created together with an individual O recorded using the current date and time. When disabled, only the individual O is recorded.","Lorsque cette option est activée, le compteur O classique natif Stash de l’image est incrémenté en même temps qu’un O individuel. Désactivée, seul l’O individuel est enregistré.":"When enabled, the image’s native Stash classic O counter is incremented together with an individual O. When disabled, only the individual O is recorded.","Masque les compteurs individuels sur les fiches de performeurs et leurs cartes. Désactivé par défaut : les compteurs restent visibles.":"Hides individual counters on performer pages and cards. Off by default: counters remain visible.","Masque les compteurs dans les historiques latéraux des scènes et des images, ainsi que sur les marqueurs Splooge et leurs aperçus. Désactivé par défaut : les compteurs restent visibles.":"Hides counters in scene and image side histories, as well as on Splooge markers and their previews. Off by default: counters remain visible.","Masque l’icône et le compteur O classique natif Stash sur les fiches et les cartes des performeurs. Désactivé par défaut : les compteurs restent visibles.":"Hides the native Stash classic O icon and counter on performer pages and cards. Off by default: counters remain visible.","Lorsqu’aucun marqueur correspondant n’est sélectionné, propose de créer un marqueur et l’associer à l’O individuel. Désactivé par défaut : enregistre l’O sans marqueur, sans afficher la proposition.":"When no matching marker is selected, offers to create a marker and associate it with the individual O. Off by default: saves the O without a marker and without showing the prompt.","Titre attribué au marqueur créé automatiquement. Ce même titre sert automatiquement à rechercher et afficher les marqueurs existants. Obligatoire : aucun titre prérempli.":"Title assigned to automatically created markers. The same title is used to find and display existing markers. Required: no default title.","Impossible de charger les performeurs : ":"Unable to load performers: ","Erreur HTTP lors du chargement des performeurs : ":"HTTP error while loading performers: ","Réponse FindPerformers invalide.":"Invalid FindPerformers response.","Erreur HTTP lors du chargement des marqueurs.":"HTTP error while loading markers.","Réponse FindSceneMarkers invalide.":"Invalid FindSceneMarkers response.","Scène introuvable.":"Scene not found.","Image introuvable.":"Image not found.","Aucun marqueur « ":"No marker titled “"," » sélectionné":"” selected","Tu peux créer automatiquement un marqueur « ":"You can automatically create a marker titled “"," » associé au tag principal « ":"” associated with the primary tag “"," » à la position actuelle de la vidéo, enregistrer l’O sans marqueur, ou annuler.":"” at the current video position, save the O without a marker, or cancel.","Le marqueur « ":"The marker “"," » est introuvable. Aucun marqueur n’a été créé.":"” could not be found. No marker was created.","Stash n’a pas confirmé la création du marqueur « ":"Stash did not confirm creation of marker “","Date de l’image — ":"Image date — ","Tu peux utiliser la date actuelle ou la date de l’image.":"You can use the current date or the image date.","Cliquer pour accéder au marqueur à ":"Click to open the marker at ","Accéder au marqueur à ":"Open marker at ","Aucun marqueur Splooge associé.":"No associated Splooge marker.","Analyse des scènes : ":"Scene scan: ","Échec du tri des marqueurs :":"Marker sorting failed: ","Échec du tri des performeurs :":"Performer sorting failed: ","Enregistrement impossible : ":"Unable to save: ","Impossible de compter les O associés aux marqueurs.":"Unable to count O entries associated with markers.","Gestion des O":"O Management","Choisir le marqueur ":"Choose the marker ","Date de l’O individuel":"Individual O date","Maintenant (date et heure actuelles)":"Now (current date and time)","Tu peux réutiliser un O classique pour plusieurs attributions individuelles.":"You can reuse a classic O for multiple individual assignments.","Aucun O classique enregistré dans cette scène.":"No classic O recorded in this scene.","À qui attribuer ce O ?":"Who should this O be assigned to?","Aucun performeur n’est associé à cette scène.":"No performer is associated with this scene.","Enregistrer un O":"Record an O","Historique de cette scène ":"History for this scene ","Historique de cette image ":"History for this image ","O individuels":"Individual O Count"};
  let ioIsFrench = true;
  let ioLocalizationObserver = null;
  function ioTranslateText(value) {
    if (ioIsFrench || typeof value !== 'string') return value;
    const trimmed = value.trim();
    const translated = IO_TRANSLATIONS_EN[trimmed];
    if (!translated) return value;
    return value.replace(trimmed, translated);
  }
  function ioTranslateSubtree(root) {
    if (ioIsFrench || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(textNode => { const next = ioTranslateText(textNode.nodeValue); if (next !== textNode.nodeValue) textNode.nodeValue = next; });
    const elements = root.nodeType === 1 ? [root].concat(Array.from(root.querySelectorAll('*'))) : Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []);
    elements.forEach(el => ['title','aria-label','placeholder','alt'].forEach(attr => { if (el.hasAttribute && el.hasAttribute(attr)) { const oldValue = el.getAttribute(attr); const next = ioTranslateText(oldValue); if (next !== oldValue) el.setAttribute(attr, next); } }));
  }
  function ioInstallLocalizationObserver() {
    if (ioLocalizationObserver) ioLocalizationObserver.disconnect();
    ioLocalizationObserver = new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'characterData') {
          const next = ioTranslateText(record.target.nodeValue);
          if (next !== record.target.nodeValue) record.target.nodeValue = next;
        }
        record.addedNodes && record.addedNodes.forEach(node => {
          if (node.nodeType === 1 || node.nodeType === 11) ioTranslateSubtree(node);
          else if (node.nodeType === 3) {
            const next = ioTranslateText(node.nodeValue);
            if (next !== node.nodeValue) node.nodeValue = next;
          }
        });
        if (record.type === 'attributes') {
          const oldValue = record.target.getAttribute(record.attributeName);
          const next = ioTranslateText(oldValue);
          if (next !== oldValue) record.target.setAttribute(record.attributeName, next);
        }
      });
    });
    ioLocalizationObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['title','aria-label','placeholder','alt']
    });
  }
  async function ioInitializeLocalization() {
    // Observe from the start: Stash/React may render plugin UI while the
    // asynchronous language query is still in flight.
    ioInstallLocalizationObserver();
    try {
      const data = await gql(`{ configuration { interface { language } } }`);
      const rawLanguage = data && data.configuration && data.configuration.interface && data.configuration.interface.language;
      const language = String(rawLanguage || '').trim().toLowerCase();
      // French is the only locale that keeps the French UI. All other locales
      // (including missing/unknown values) use English as the public fallback.
      ioIsFrench = language === 'fr' || language.startsWith('fr-');
    } catch (error) {
      // Do not silently leave a non-French installation in French if the
      // configuration query fails; English is the fallback.
      console.warn('[Individual O] Unable to detect Stash language; using English.', error);
      ioIsFrench = false;
    }
    if (!ioIsFrench) ioTranslateSubtree(document.body);
  }

  function init() {
    ioInitializeLocalization();
    // Initialize the three recommended options only when Stash has no saved
    // value for them. Explicit user choices are never overwritten on update.
    initializeDefaultOnSettings().then(() => {
      classicSceneSyncSettingReadAt = 0;
      classicImageSyncSettingReadAt = 0;
      markerSettingsReadAt = 0;
      isClassicSceneSyncEnabled();
      isClassicImageSyncEnabled();
      loadMarkerSettings(true);
    });
    installIndividualSortInterceptor();
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleScan);
    scheduleScan();
    registerGlobalHistoryRoute();
    if (new URLSearchParams(window.location.search).get('individual-o-history') === '1') {
      window.history.replaceState({ individualOHistory: true }, '', '/plugin/individual-o/history');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { individualOHistory: true } }));
    }
    installGlobalHistoryLauncher();
    if (window.PluginApi && window.PluginApi.Event && typeof window.PluginApi.Event.on === 'function') {
      try { window.PluginApi.Event.on('stash:location', scheduleScan); } catch (_) { /* optional event */ }
    }
    console.info('[Individual O] Plugin chargé.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();