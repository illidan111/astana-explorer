/* Leaflet, clustering, persistent favorites and themes are retained from the original app. */
(async () => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const normalize = (value) => String(value).toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const pluralRules = new Intl.PluralRules('ru');
  const countLabel = (count, forms) => `${count} ${forms[pluralRules.select(count)] || forms.other}`;
  const placeForms = { one: 'место', few: 'места', other: 'мест' };
  const pointForms = { one: 'точка', few: 'точки', other: 'точек' };
  const exampleForms = { one: 'пример', few: 'примера', other: 'примеров' };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 760px)');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const searchInput = byId('search-input');
  const filterChips = byId('filter-chips');
  const attractionList = byId('attraction-list');
  const card = byId('attraction-card');
  const findMeButton = byId('find-me-button');
  const favoritesButton = byId('favorites-button');
  const categoryOrder = ['attraction', 'park', 'culture', 'food', 'shopping', 'event'];
  const FAVORITES_STORAGE_KEY = 'astana-explorer-favorites';
  const THEME_STORAGE_KEY = 'astana-explorer-theme';
  const attractionIds = new Set(attractions.map((place) => place.id));
  const placesById = new Map(attractions.map((place) => [place.id, place]));
  const markersById = new Map();
  const listItemsById = new Map();
  const searchIndex = new Map(attractions.map((place) => [place.id, normalize([
    place.name, ...(place.aliases || []), place.summary, place.description, place.area, place.address,
    categories[place.category].label, ...(place.tags || [])
  ].join(' '))]));

  let favoriteIds = new Set();
  let activeFilter = 'all';
  let favoritesOnly = false;
  let searchQuery = '';
  let sortOrder = 'curated';
  let selectedAttraction = null;
  let selectedMarker = null;
  let returnFocus = null;
  let currentTheme = document.documentElement.dataset.theme;
  let hasThemePreference = false;
  let map = null;
  let attractionMarkers = null;
  let tileLayer = null;
  let tileRevision = 0;
  let tileTimeout = null;
  let toastTimeout = null;
  let userMarker = null;
  let accuracyCircle = null;
  let locationRequestInProgress = false;
  let locationTimeout = null;
  let locationRevision = 0;
  let mapInitializing = false;
  let resultsTimeout = null;
  let mapLoadAttempt = 0;
  let shareRevision = 0;
  let sharePending = false;
  let hoveredPlaceId = null;
  let focusedPlaceId = null;
  let cardScrollPosition = 0;
  let cardPhotoRevision = 0;
  const cardCloseContexts = [];

  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) favoriteIds = new Set(saved.filter((id) => attractionIds.has(id)));
  } catch { /* A damaged or unavailable store must not prevent browsing. */ }
  try {
    hasThemePreference = ['light', 'dark'].includes(localStorage.getItem(THEME_STORAGE_KEY));
  } catch { /* The system theme can still be followed without browser storage. */ }

  function showLocationStatus(message, duration = 5500) {
    const toast = byId('location-status');
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.hidden = false;
    if (duration) toastTimeout = setTimeout(() => { toast.hidden = true; }, duration);
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteIds]));
      return true;
    } catch {
      return false;
    }
  }

  function getFilteredAttractions() {
    const terms = searchQuery.split(/\s+/).filter(Boolean);
    const results = attractions.filter((place) => (
      (place.kind !== 'event' || activeFilter === 'event' || favoritesOnly)
      && (activeFilter === 'all' || place.category === activeFilter)
      && (!favoritesOnly || favoriteIds.has(place.id))
      && terms.every((term) => searchIndex.get(place.id).includes(term))
    ));
    return sortOrder === 'name'
      ? results.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      : results;
  }

  function buildFilters() {
    ['all', ...categoryOrder].forEach((id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-chip';
      button.dataset.filter = id;
      button.innerHTML = icon(id);
      button.append(document.createTextNode(id === 'all' ? 'Все места' : categories[id].label));
      button.setAttribute('aria-pressed', String(id === 'all'));
      filterChips.append(button);
    });
  }

  function photoForPlace(place) {
    const image = (place.kind === 'event' ? placesById.get(place.venueId) : place)?.image;
    return image && typeof image.src === 'string' && image.src
      && Number.isFinite(image.width) && image.width > 0
      && Number.isFinite(image.height) && image.height > 0 ? image : null;
  }

  function addListPhoto(thumbnail, place) {
    const image = photoForPlace(place);
    if (!image) {
      thumbnail.classList.add('photo-unavailable');
      return;
    }
    const photo = document.createElement('img');
    photo.className = 'place-photo';
    photo.alt = '';
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.width = image.width;
    photo.height = image.height;
    photo.addEventListener('load', () => thumbnail.classList.add('has-photo'), { once: true });
    photo.addEventListener('error', () => {
      thumbnail.classList.remove('has-photo');
      thumbnail.classList.add('photo-unavailable');
      photo.remove();
    }, { once: true });
    photo.src = image.src;
    thumbnail.append(photo);
  }

  function renderCardPhoto(place) {
    const previousPhoto = byId('card-photo');
    if (!previousPhoto) return;
    const revision = ++cardPhotoRevision;
    const photo = previousPhoto.cloneNode(false);
    previousPhoto.onload = null;
    previousPhoto.onerror = null;
    photo.removeAttribute('src');
    photo.removeAttribute('srcset');
    photo.alt = '';
    photo.hidden = true;
    previousPhoto.replaceWith(photo);
    const wrapper = photo.closest('.card-photo-wrap');
    const fallback = byId('card-photo-fallback');
    const credit = byId('card-photo-credit');
    const license = byId('card-photo-license');
    wrapper?.classList.remove('has-photo', 'photo-unavailable');
    wrapper?.style.setProperty('--category-color', categories[place.category].color);
    if (fallback) {
      fallback.innerHTML = icon(place.icon || place.category);
      fallback.hidden = false;
    }
    if (credit) {
      credit.hidden = true;
      credit.textContent = '';
      credit.removeAttribute('href');
      credit.removeAttribute('aria-label');
    }
    if (license) {
      license.hidden = true;
      license.textContent = '';
      license.removeAttribute('href');
      license.removeAttribute('aria-label');
    }
    const image = photoForPlace(place);
    if (!image) {
      wrapper?.classList.add('photo-unavailable');
      return;
    }
    photo.alt = image.alt || `Фотография: ${(place.kind === 'event' ? placesById.get(place.venueId) : place).name}`;
    photo.loading = 'eager';
    photo.decoding = 'async';
    photo.width = image.width;
    photo.height = image.height;
    photo.onload = () => {
      if (revision !== cardPhotoRevision || !photo.isConnected) return;
      wrapper?.classList.add('has-photo');
      if (fallback) fallback.hidden = true;
      if (credit && image.credit && image.creditUrl) {
        credit.textContent = image.credit;
        credit.href = image.creditUrl;
        credit.setAttribute('aria-label', `${image.credit}. Источник фотографии откроется в новой вкладке.`);
        credit.hidden = false;
      }
      if (license && image.license && image.licenseUrl) {
        license.textContent = image.license;
        license.href = image.licenseUrl;
        license.setAttribute('aria-label', `${image.license}. Лицензия фотографии откроется в новой вкладке.`);
        license.hidden = false;
      }
    };
    photo.onerror = () => {
      if (revision !== cardPhotoRevision || !photo.isConnected) return;
      photo.onload = null;
      photo.onerror = null;
      photo.hidden = true;
      photo.removeAttribute('src');
      wrapper?.classList.remove('has-photo');
      wrapper?.classList.add('photo-unavailable');
      if (fallback) fallback.hidden = false;
      if (credit) credit.hidden = true;
      if (license) license.hidden = true;
    };
    photo.hidden = false;
    photo.src = image.src;
  }

  function updateSelectionNavigation() {
    const results = getFilteredAttractions();
    const index = results.findIndex((place) => place.id === selectedAttraction?.id);
    const previous = index > 0 ? results[index - 1] : null;
    const next = index >= 0 ? results[index + 1] : null;
    [['previous-place', previous, 'Предыдущее место'], ['next-place', next, 'Следующее место']]
      .forEach(([id, place, label]) => {
        const button = byId(id);
        if (!button) return;
        button.disabled = !place;
        button.setAttribute('aria-label', place ? `${label}: ${place.name}` : label);
      });
    const position = byId('selection-position');
    if (position) position.textContent = index >= 0 ? `${index + 1} из ${results.length}` : '';
  }

  function navigatePlaces(direction, trigger = document.activeElement) {
    const results = getFilteredAttractions();
    const index = results.findIndex((place) => place.id === selectedAttraction?.id);
    const place = index >= 0 ? results[index + direction] : null;
    if (!place) return;
    // Reuse selection, routing and share cancellation without changing the query,
    // the list's scroll position, or the user's mobile view.
    showAttraction(place, listItemsById.get(place.id).querySelector('.attraction-list-button'));
    if (trigger instanceof HTMLElement && card.contains(trigger) && !trigger.disabled) {
      trigger.focus({ preventScroll: true });
    } else {
      const fallback = byId(direction > 0 ? 'previous-place' : 'next-place');
      (fallback && !fallback.disabled ? fallback : byId('close-button')).focus({ preventScroll: true });
    }
  }

  function buildListItem(place) {
    const item = document.createElement('li');
    item.className = 'attraction-list-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attraction-list-button';
    button.dataset.placeId = place.id;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'attraction-card');
    const thumbnail = document.createElement('span');
    thumbnail.className = 'place-thumbnail';
    thumbnail.style.setProperty('--category-color', categories[place.category].color);
    thumbnail.setAttribute('aria-hidden', 'true');
    thumbnail.innerHTML = icon(place.icon || place.category);
    addListPhoto(thumbnail, place);
    const copy = document.createElement('span');
    copy.className = 'place-copy';
    const category = document.createElement('span');
    category.className = 'place-category';
    category.textContent = categories[place.category].label;
    category.style.setProperty('--category-color', categories[place.category].color);
    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = place.name;
    const description = document.createElement('span');
    description.className = 'place-description';
    description.textContent = place.summary || place.description;
    const meta = document.createElement('span');
    meta.className = 'place-meta';
    meta.innerHTML = icon(place.kind === 'event' ? 'event' : 'pin');
    meta.append(document.createTextNode(place.kind === 'event' ? 'Пример · дата не назначена' : (place.address || place.area)));
    copy.append(name, category, meta, description);
    button.append(thumbnail, copy);
    button.addEventListener('click', () => showAttraction(place, button));
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'list-favorite';
    favorite.dataset.favoriteId = place.id;
    favorite.innerHTML = icon('bookmark', 'bookmark-icon');
    favorite.addEventListener('click', () => toggleFavorite(place));
    item.append(button, favorite);
    return item;
  }

  function updateFavoriteButtons() {
    byId('favorite-count').textContent = favoriteIds.size;
    favoritesButton.setAttribute('aria-pressed', String(favoritesOnly));
    favoritesButton.setAttribute('aria-label', favoritesOnly ? 'Показать всю подборку' : 'Показать избранное');
    listItemsById.forEach((item, id) => {
      const button = item.querySelector('.list-favorite');
      const saved = favoriteIds.has(id);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', `${saved ? 'Убрать из избранного' : 'Сохранить'}: ${placesById.get(id).name}`);
      button.title = saved ? 'Убрать из избранного' : 'Сохранить';
    });
    if (selectedAttraction) {
      const saved = favoriteIds.has(selectedAttraction.id);
      byId('favorite-toggle').setAttribute('aria-pressed', String(saved));
      byId('favorite-toggle').setAttribute('aria-label', saved ? 'Убрать из избранного' : 'Добавить в избранное');
      byId('favorite-label').textContent = saved ? 'Сохранено' : 'Сохранить';
    }
  }

  function renderAttractionList(filtered) {
    // Reuse buttons so selection and favorite changes preserve keyboard focus.
    const focused = document.activeElement;
    const scrollTop = attractionList.scrollTop;
    const previousItems = [...attractionList.children];
    const nextItems = filtered.map((place) => listItemsById.get(place.id));
    const sameItems = previousItems.length === nextItems.length
      && previousItems.every((item, index) => item === nextItems[index]);
    if (sameItems && filtered.length) {
      highlightSelection();
      return;
    }
    const focusedIndex = previousItems.findIndex((item) => item.contains(focused));
    const fragment = document.createDocumentFragment();
    filtered.forEach((place) => {
      const item = listItemsById.get(place.id);
      item.querySelector('.attraction-list-button').setAttribute('aria-current', String(selectedAttraction?.id === place.id));
      fragment.append(item);
    });
    if (!filtered.length) {
      const item = document.createElement('li');
      item.className = 'empty-state';
      item.innerHTML = icon(favoritesOnly ? 'bookmark' : 'search');
      const heading = document.createElement('h2');
      heading.textContent = favoritesOnly && !favoriteIds.size ? 'Ваши открытия — здесь' : 'Ничего не нашлось';
      const text = document.createElement('p');
      text.textContent = favoritesOnly && !favoriteIds.size
        ? 'Нажмите на закладку у места или события, чтобы сохранить его для будущей прогулки.'
        : 'Попробуйте другое название, например «парк», или сбросьте выбранные фильтры.';
      const reset = document.createElement('button');
      reset.className = 'secondary-button';
      reset.textContent = favoritesOnly && !favoriteIds.size ? 'Открыть подборку' : 'Сбросить фильтры';
      reset.addEventListener('click', resetFilters);
      item.append(heading, text, reset);
      fragment.append(item);
    }
    attractionList.replaceChildren(fragment);
    attractionList.scrollTop = scrollTop;
    if (focused instanceof HTMLElement && attractionList.contains(focused)) focused.focus({ preventScroll: true });
    else if (focusedIndex >= 0) {
      const nearbyItem = attractionList.children[Math.min(focusedIndex, attractionList.children.length - 1)];
      const selector = focused.classList.contains('list-favorite') ? '.list-favorite' : '.attraction-list-button';
      const fallback = nearbyItem?.querySelector(selector) || nearbyItem?.querySelector('button') || favoritesButton;
      fallback.focus({ preventScroll: true });
    }
  }

  function filterMarkers({ fit = false } = {}) {
    const filtered = getFilteredAttractions();
    byId('results-heading').textContent = favoritesOnly ? 'Ваши сохранённые места'
      : searchQuery ? 'Результаты поиска'
        : activeFilter !== 'all' ? categories[activeFilter].label : 'Все места';
    const visibleIds = new Set(filtered.map((place) => place.id));
    const examplesCount = filtered.filter(place => place.demo).length;
    const placesCount = filtered.length - examplesCount;
    byId('places-counter').textContent = examplesCount === filtered.length && examplesCount
      ? `${countLabel(examplesCount, exampleForms)} событий`
      : [countLabel(placesCount, placeForms), examplesCount ? countLabel(examplesCount, exampleForms) : ''].filter(Boolean).join(' · ');
    byId('map-count-text').textContent = `${countLabel(filtered.length, pointForms)} на карте${examplesCount ? ' · события — примеры' : ''}`;
    byId('events-notice').hidden = !examplesCount || examplesCount !== filtered.length;
    byId('mobile-count').textContent = filtered.length;
    clearTimeout(resultsTimeout);
    resultsTimeout = setTimeout(() => {
      byId('results-status').textContent = [
        `Найдено объектов: ${filtered.length}.`,
        activeFilter !== 'all' ? `Категория: ${categories[activeFilter].label}.` : '',
        favoritesOnly ? 'Только избранное.' : '',
        !filtered.length ? 'Измените запрос или сбросьте фильтры.' : ''
      ].filter(Boolean).join(' ');
    }, 200);
    byId('map-empty').hidden = filtered.length > 0;
    byId('map-empty-text').textContent = favoritesOnly && !favoriteIds.size
      ? 'Сохраните понравившиеся места с помощью закладки.'
      : 'Попробуйте другое название или категорию.';
    byId('clear-search').hidden = !searchInput.value;
    byId('active-summary').hidden = activeFilter === 'all' && !searchQuery && !favoritesOnly;
    byId('active-summary-text').textContent = [
      favoritesOnly ? 'Избранное' : '', activeFilter !== 'all' ? categories[activeFilter].label : '',
      searchQuery ? 'Поиск' : ''
    ].filter(Boolean).join(' · ');
    filterChips.querySelectorAll('button').forEach((chip) => {
      const selected = chip.dataset.filter === activeFilter;
      chip.classList.toggle('is-active', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
    markersById.forEach((marker, id) => {
      if (visibleIds.has(id)) {
        if (!attractionMarkers.hasLayer(marker)) attractionMarkers.addLayer(marker);
      } else if (attractionMarkers.hasLayer(marker)) attractionMarkers.removeLayer(marker);
    });
    if (selectedAttraction && !visibleIds.has(selectedAttraction.id)) {
      if (card.open) closeAttraction({ restoreFocus: false });
      clearSelection();
    }
    if (hoveredPlaceId && !visibleIds.has(hoveredPlaceId)) hoveredPlaceId = null;
    if (focusedPlaceId && !visibleIds.has(focusedPlaceId)) focusedPlaceId = null;
    renderAttractionList(filtered);
    highlightSelection();
    if (fit) attractionList.scrollTop = 0;
    updateFavoriteButtons();
    updateSelectionNavigation();
    if (fit && filtered.length) fitResults();
  }

  function resetFilters() {
    activeFilter = 'all';
    favoritesOnly = false;
    searchQuery = '';
    searchInput.value = '';
    filterMarkers({ fit: true });
    searchInput.focus({ preventScroll: true });
  }

  function toggleFavorite(place) {
    const added = !favoriteIds.has(place.id);
    if (added) favoriteIds.add(place.id);
    else favoriteIds.delete(place.id);
    const persisted = saveFavorites();
    filterMarkers();
    if (!card.open) showLocationStatus(persisted
      ? (added ? 'Сохранено в избранном' : 'Удалено из избранного')
      : 'Сохранено только на время сеанса: хранилище браузера недоступно.');
    else if (!persisted && !byId('card-notice').textContent.includes('хранилище браузера недоступно')) {
      byId('card-notice').textContent += ' Избранное доступно только на время этого сеанса: хранилище браузера недоступно.';
    }
  }

  function clearSelection() {
    selectedMarker?.getElement()?.classList.remove('is-selected');
    selectedMarker?.setZIndexOffset(0);
    selectedAttraction = null;
    selectedMarker = null;
  }

  function highlightSelection() {
    const highlightedId = hoveredPlaceId || focusedPlaceId;
    markersById.forEach((marker, id) => {
      marker.getElement()?.classList.toggle('is-selected', id === selectedAttraction?.id);
      marker.getElement()?.classList.toggle('is-highlighted', id === highlightedId);
      marker.setZIndexOffset(id === selectedAttraction?.id ? 1000 : id === highlightedId ? 800 : 0);
    });
    listItemsById.forEach((item, id) => {
      item.querySelector('.attraction-list-button').setAttribute('aria-current', String(id === selectedAttraction?.id));
      item.classList.toggle('is-highlighted', id === highlightedId);
    });
    byId('map').querySelectorAll('.custom-marker-cluster.is-highlighted')
      .forEach((element) => element.classList.remove('is-highlighted'));
    const highlightedMarker = markersById.get(highlightedId);
    if (highlightedMarker) {
      attractionMarkers?.getVisibleParent?.(highlightedMarker)?.getElement()?.classList.add('is-highlighted');
    }
  }

  function openAttractionCard() {
    const container = mobile.matches ? document.body : byId('list-view');
    if (card.parentElement !== container) container.append(card);
    card.dataset.presentation = mobile.matches ? 'sheet' : 'inspector';
    card.setAttribute('aria-modal', String(mobile.matches));
    byId('close-button').setAttribute('aria-label', mobile.matches ? 'Закрыть карточку' : 'К списку');
    if (byId('close-label')) byId('close-label').textContent = mobile.matches ? 'Закрыть' : 'К списку';
    if (mobile.matches) card.showModal();
    else card.show();
  }

  function closeAttraction({ restoreFocus = true } = {}) {
    if (!card.open) return;
    const focused = document.activeElement;
    cardCloseContexts.push({ restoreFocus });
    resetShareState();
    card.close();
    // Native dialogs restore the opener synchronously. Filtering must keep an
    // outside input or category button focused so typing and navigation continue.
    if (!restoreFocus && focused instanceof HTMLElement && !card.contains(focused)
      && focused.isConnected) focused.focus({ preventScroll: true });
  }

  function syncCardPresentation() {
    if (!card.open || byId('info-dialog').open || card.matches(':modal') === mobile.matches) return;
    const focused = document.activeElement;
    // The desktop sidebar may already be display:none after the media query
    // changes. Its child's scrollTop then reads zero until it leaves that tree.
    const scrollTop = card.getClientRects().length ? card.scrollTop : cardScrollPosition;
    // A dialog must close before switching between show() and showModal().
    // This lifecycle event is presentation-only: selection and sharing survive.
    cardCloseContexts.push({ presentationChange: true });
    card.close();
    openAttractionCard();
    card.scrollTop = scrollTop;
    cardScrollPosition = card.scrollTop;
    if (focused instanceof HTMLElement && focused.isConnected
      && (!mobile.matches || card.contains(focused))
      && (focused.checkVisibility?.() ?? focused.getClientRects().length > 0)) {
      focused.focus({ preventScroll: true });
    } else byId('close-button').focus({ preventScroll: true });
  }

  function updateMarkerLabel(marker) {
    const tooltip = marker.getTooltip();
    const permanent = Boolean(map && map.getZoom() >= 15);
    if (!tooltip || tooltip.options.permanent === permanent) return;
    const content = tooltip.getContent();
    marker.unbindTooltip().bindTooltip(content, {
      direction: 'top', offset: [0, -30], permanent, className: 'place-map-label'
    });
  }

  function showAttraction(place, trigger) {
    const wasOpen = card.open;
    const focusedInside = card.contains(document.activeElement);
    if (wasOpen && selectedAttraction?.id === place.id) {
      if (trigger) returnFocus = trigger;
      highlightSelection();
      return;
    }
    resetShareState();
    clearSelection();
    selectedAttraction = place;
    selectedMarker = markersById.get(place.id);
    selectedMarker?.setZIndexOffset(1000);
    returnFocus = trigger || document.activeElement;
    byId('card-art').style.setProperty('--category-color', categories[place.category].color);
    byId('card-art').innerHTML = icon(place.icon || place.category);
    renderCardPhoto(place);
    card.querySelector('.source-details').open = false;
    byId('card-category').textContent = place.eventLabel || categories[place.category].label;
    byId('card-name').textContent = place.name;
    const destination = place.kind === 'event' ? placesById.get(place.venueId) : place;
    byId('card-area').textContent = destination.address || destination.area;
    if (byId('card-summary')) byId('card-summary').textContent = place.summary || place.description;
    byId('card-description').textContent = place.description;
    byId('card-tags').replaceChildren(...place.tags.map((tag) => {
      const element = document.createElement('span');
      element.className = 'card-tag';
      element.textContent = tag;
      return element;
    }));
    byId('card-notice').textContent = place.kind === 'event'
      ? 'Демонстрационное событие. Площадка указана для примера: дата, организатор и билеты отсутствуют. Это не анонс.'
      : 'Маркер обозначает объект, а не проверенный вход. Часы работы, условия посещения и стоимость уточните по ссылке на источник.';
    const [latitude, longitude] = destination.coordinates;
    byId('card-point').textContent = `${destination.pointLabel} · ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    byId('card-verified').textContent = `Данные ${place.kind === 'event' ? 'площадки ' : ''}проверены ${new Intl.DateTimeFormat('ru', { timeZone: 'UTC' }).format(new Date(destination.verifiedAt + 'T00:00:00Z'))}`;
    byId('card-coordinate-source').href = destination.coordinateSourceUrl;
    const source = byId('card-source');
    source.hidden = !destination.sourceUrl;
    if (destination.sourceUrl) {
      source.href = destination.sourceUrl;
      byId('card-source-label').textContent = destination.sourceLabel || 'Источник';
    } else source.removeAttribute('href');
    const program = byId('card-program');
    program.hidden = !destination.programUrl;
    if (destination.programUrl) {
      program.href = destination.programUrl;
      byId('card-program-label').textContent = destination.programLabel;
    } else program.removeAttribute('href');
    // One destination drives the marker, provenance and route, including demo host venues.
    const routeUrl = new URL('https://www.google.com/maps/dir/');
    routeUrl.search = new URLSearchParams({ api: '1', destination: destination.routeQuery }).toString();
    // A named address and reviewed place ID avoid reverse-geocoding coordinates
    // to a neighbouring tenant. The full address also disambiguates the fallback.
    routeUrl.searchParams.set('destination_place_id', destination.googlePlaceId);
    byId('route-button').href = routeUrl.href;
    byId('route-label').textContent = place.kind === 'event' ? 'Построить маршрут к площадке' : 'Построить маршрут';
    byId('route-hint').textContent = `Google Maps · ${destination.routeDestinationLabel || destination.name}. Укажите начало маршрута в Google Maps.`;
    updateFavoriteButtons();
    updateSelectionNavigation();
    highlightSelection();
    if (!card.open) openAttractionCard();
    if (!mobile.matches) revealSelectedOnMap();
    card.scrollTop = 0;
    cardScrollPosition = 0;
    if (!wasOpen || mobile.matches || focusedInside) byId('close-button').focus({ preventScroll: true });
  }

  function setMobileView(view) {
    document.body.dataset.mobileView = view;
    byId('view-map').setAttribute('aria-pressed', String(view === 'map'));
    byId('view-list').setAttribute('aria-pressed', String(view === 'list'));
    if (view === 'map') requestAnimationFrame(() => map?.invalidateSize({ pan: false }));
  }

  function fitResults() {
    if (!map) return;
    const filtered = getFilteredAttractions();
    const points = (filtered.length ? filtered : attractions).map((place) => place.coordinates);
    map.stop();
    const { x: width, y: height } = map.getSize();
    // The map can be very short beside a phone keyboard or in landscape.
    // Reserve space for controls without consuming the entire fit viewport.
    map.fitBounds(points, {
      paddingTopLeft: [Math.min(70, width * .15), Math.min(100, height * .3)],
      paddingBottomRight: [Math.min(70, width * .2), Math.min(48, height * .2)],
      maxZoom: 15, animate: false
    });
  }

  function focusSelectedOnMap() {
    if (!map || !selectedAttraction) return;
    const place = selectedAttraction;
    const marker = markersById.get(place.id);
    if (!attractionMarkers.hasLayer(marker)) {
      activeFilter = 'all';
      favoritesOnly = false;
      searchQuery = '';
      searchInput.value = '';
      filterMarkers();
    }
    setMobileView('map');
    map.invalidateSize({ pan: false });
    map.stop();
    attractionMarkers.unspiderfy?.();
    // Expand coincident points synchronously. zoomToShowLayer keeps private
    // moveend handlers that can reference a removed marker after a fast search.
    map.setView(place.coordinates, Math.max(16, map.getZoom()), { animate: false });
    const parent = attractionMarkers.getVisibleParent?.(marker);
    if (parent && parent !== marker) parent.spiderfy();
    marker.openTooltip();
    highlightSelection();
  }

  function revealSelectedOnMap() {
    if (!map || !selectedAttraction || !selectedMarker) return;
    map.invalidateSize({ pan: false });
    map.stop();
    attractionMarkers.unspiderfy?.();
    map.setView(selectedAttraction.coordinates, Math.max(15, map.getZoom()), { animate: false });
    const parent = attractionMarkers.getVisibleParent?.(selectedMarker);
    if (parent && parent !== selectedMarker) parent.spiderfy();
    highlightSelection();
  }

  function setMapStatus(message, canRetry = false) {
    byId('map-status-text').textContent = message;
    byId('map-status').hidden = !message;
    byId('retry-map').hidden = !canRetry;
    byId('list-map-status').textContent = map
      ? 'Подложка карты недоступна. Можно продолжить поиск в списке.'
      : 'Карта не загрузилась. Поиск, карточки и избранное работают.';
    byId('list-map-status').hidden = !message || !canRetry;
    byId('map-announcement').textContent = message;
  }

  function loadMapTiles() {
    if (!map) return;
    const revision = ++tileRevision;
    clearTimeout(tileTimeout);
    if (tileLayer) map.removeLayer(tileLayer);
    let loaded = 0;
    let failed = 0;
    setMapStatus('Загружаем карту…');
    tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    const unavailable = () => {
      if (revision !== tileRevision) return;
      setMapStatus('Подложка карты недоступна.', true);
    };
    tileLayer.on('loading', () => {
      if (revision !== tileRevision) return;
      loaded = 0;
      failed = 0;
      setMapStatus('Загружаем карту…');
      clearTimeout(tileTimeout);
      tileTimeout = setTimeout(unavailable, 10000);
    });
    tileLayer.on('tileload', () => { loaded += 1; });
    tileLayer.on('tileerror', () => { failed += 1; unavailable(); });
    tileLayer.on('load', () => {
      if (revision !== tileRevision) return;
      clearTimeout(tileTimeout);
      if (failed || !loaded) unavailable();
      else setMapStatus('');
    });
    tileTimeout = setTimeout(unavailable, 10000);
    tileLayer.addTo(map);
  }

  function initializeMap() {
    if (!window.L) {
      setMapStatus('Не удалось загрузить карту. Места доступны в списке.', true);
      byId('map').setAttribute('aria-label', 'Карта недоступна');
      document.querySelectorAll('.map-controls button').forEach((button) => { button.disabled = true; });
      byId('explore-button').disabled = true;
      if (mobile.matches) setMobileView('list');
      return;
    }
    map = L.map('map', { zoomControl: false, minZoom: 3, maxZoom: 19, zoomSnap: .5,
      zoomAnimation: false, fadeAnimation: !reducedMotion.matches,
      markerZoomAnimation: !reducedMotion.matches
    }).setView([51.128, 71.434], 13);
    map.attributionControl.setPrefix(false);
    attractionMarkers = L.markerClusterGroup ? L.markerClusterGroup({
      maxClusterRadius: 42, showCoverageOnHover: false,
      animate: false, spiderfyOnMaxZoom: true,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<span aria-label="Объектов: ${count}. Нажмите, чтобы раскрыть">${count}</span>`,
          className: 'custom-marker-cluster', iconSize: [42, 42]
        });
      }
    }).addTo(map) : L.featureGroup().addTo(map);
    attractions.forEach((place) => {
      const category = categories[place.category];
      const marker = L.marker(place.coordinates, {
        icon: L.divIcon({
          html: `<span class="marker-pin" style="--category-color:${category.color}">${icon(place.icon || place.category)}</span>`,
          className: 'attraction-icon', iconSize: [42, 42], iconAnchor: [21, 36]
        }),
        title: `${place.name} · ${category.label}${place.demo ? ' · Пример' : ''}`,
        alt: place.name, keyboard: true
      });
      const tooltip = document.createElement('span');
      tooltip.textContent = place.name;
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -30] });
      marker.on('click', () => showAttraction(place, marker.getElement()));
      marker.on('mouseover', () => { hoveredPlaceId = place.id; highlightSelection(); });
      marker.on('mouseout', () => { hoveredPlaceId = null; highlightSelection(); });
      marker.on('add', () => {
        const element = marker.getElement();
        element?.setAttribute('aria-label', marker.options.title);
        element?.setAttribute('aria-haspopup', 'dialog');
        element?.setAttribute('data-marker-id', place.id);
        element?.classList.toggle('is-selected', selectedAttraction?.id === place.id);
        element?.classList.toggle('is-highlighted', (hoveredPlaceId || focusedPlaceId) === place.id);
        updateMarkerLabel(marker);
      });
      markersById.set(place.id, marker);
      attractionMarkers.addLayer(marker);
    });
    const labelClusters = () => {
      byId('map').querySelectorAll('.custom-marker-cluster').forEach((element) => {
        element.setAttribute('aria-label', `Объектов: ${element.textContent}. Нажмите, чтобы раскрыть`);
      });
    };
    attractionMarkers.on('animationend', () => { highlightSelection(); labelClusters(); });
    map.on('layeradd zoomend', labelClusters);
    map.on('zoomend', () => markersById.forEach(updateMarkerLabel));
    fitResults();
    loadMapTiles();
    map.on('zoomend', () => {
      byId('zoom-in').disabled = map.getZoom() >= map.getMaxZoom();
      byId('zoom-out').disabled = map.getZoom() <= map.getMinZoom();
    });
    byId('map').addEventListener('keydown', (event) => {
      if ([' ', 'Enter'].includes(event.key) && event.target.matches('.leaflet-marker-icon[role="button"]')) {
        event.preventDefault();
        event.stopPropagation();
        event.target.click();
      }
    });
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => requestAnimationFrame(() => map.invalidateSize({ pan: false })));
      observer.observe(byId('map'));
    }
  }

  function updateThemeToggle() {
    const dark = currentTheme === 'dark';
    const toggle = byId('theme-toggle');
    toggle.innerHTML = icon(dark ? 'sun' : 'moon');
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    toggle.title = toggle.getAttribute('aria-label');
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    updateThemeToggle();
  }

  function resetShareState() {
    shareRevision += 1;
    sharePending = false;
    const fallback = byId('share-fallback');
    const status = byId('share-status');
    byId('share-place')?.setAttribute('aria-busy', 'false');
    if (fallback) fallback.hidden = true;
    if (status) {
      status.textContent = '';
      status.hidden = true;
    }
  }

  function openLinkedPlace() {
    const id = new URLSearchParams(window.location.hash.slice(1)).get('place');
    const place = placesById.get(id);
    if (!place) return;
    if (!getFilteredAttractions().some((result) => result.id === place.id)) {
      activeFilter = place.kind === 'event' ? 'event' : 'all';
      favoritesOnly = false;
      searchQuery = '';
      searchInput.value = '';
      filterMarkers();
    }
    if (mobile.matches) setMobileView('list');
    showAttraction(place, listItemsById.get(id).querySelector('.attraction-list-button'));
  }

  async function shareSelectedPlace() {
    if (!selectedAttraction || sharePending) return;
    const id = selectedAttraction.id;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = new URLSearchParams({ place: id }).toString();
    resetShareState();
    const revision = shareRevision;
    sharePending = true;
    byId('share-place')?.setAttribute('aria-busy', 'true');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url.href);
      if (revision === shareRevision && card.open && selectedAttraction?.id === id) {
        const status = byId('share-status');
        if (status) {
          status.hidden = false;
          status.textContent = 'Ссылка на место скопирована';
        }
      }
    } catch {
      if (revision !== shareRevision || !card.open || selectedAttraction?.id !== id) return;
      const fallback = byId('share-fallback');
      const input = byId('share-url');
      if (!fallback || !input) return;
      input.value = url.href;
      fallback.hidden = false;
      const status = byId('share-status');
      if (status) {
        status.hidden = false;
        status.textContent = 'Автоматическое копирование недоступно. Скопируйте выделенную ссылку.';
      }
      input.focus({ preventScroll: true });
      input.select();
      input.scrollIntoView({ block: 'nearest' });
    } finally {
      if (revision === shareRevision) {
        sharePending = false;
        byId('share-place')?.setAttribute('aria-busy', 'false');
      }
    }
  }

  function finishLocationRequest() {
    clearTimeout(locationTimeout);
    locationRequestInProgress = false;
    findMeButton.disabled = false;
    findMeButton.setAttribute('aria-busy', 'false');
  }

  function handleLocationError(error) {
    finishLocationRequest();
    const messages = {
      1: 'Доступ к геолокации не разрешён. Можно продолжить поиск на карте или разрешить доступ в настройках браузера.',
      2: 'Не удалось определить местоположение. Попробуйте ещё раз.',
      3: 'Определение местоположения заняло слишком много времени. Попробуйте ещё раз.'
    };
    showLocationStatus(messages[error?.code] || messages[2], 8500);
  }

  buildFilters();
  attractions.forEach((place) => listItemsById.set(place.id, buildListItem(place)));
  // The catalogue and event handlers are ready before optional map resources.
  // Slow map loading must never swallow search, theme or category actions.
  searchQuery = normalize(searchInput.value);
  filterMarkers();
  updateThemeToggle();

  filterChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    activeFilter = activeFilter === chip.dataset.filter ? 'all' : chip.dataset.filter;
    filterMarkers({ fit: true });
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  });
  searchInput.addEventListener('input', () => {
    searchQuery = normalize(searchInput.value);
    filterMarkers({ fit: true });
  });
  byId('clear-search').addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    filterMarkers({ fit: true });
    searchInput.focus();
  });
  byId('sort-select').addEventListener('change', (event) => {
    sortOrder = event.target.value;
    filterMarkers();
    attractionList.scrollTop = 0;
  });
  byId('reset-filters').addEventListener('click', resetFilters);
  byId('map-reset-filters').addEventListener('click', resetFilters);
  favoritesButton.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    filterMarkers({ fit: true });
    if (mobile.matches) setMobileView('list');
  });
  byId('favorite-toggle').addEventListener('click', () => {
    if (selectedAttraction) toggleFavorite(selectedAttraction);
  });
  byId('close-button').addEventListener('click', () => closeAttraction());
  card.addEventListener('scroll', () => {
    if (card.open && card.getClientRects().length) cardScrollPosition = card.scrollTop;
  }, { passive: true });
  card.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeAttraction();
  });
  card.addEventListener('close', () => {
    const context = cardCloseContexts.shift();
    if (context?.presentationChange || card.open) return;
    if (!context) resetShareState();
    const visible = getFilteredAttractions().some((place) => place.id === selectedAttraction?.id);
    if (!visible) clearSelection();
    highlightSelection();
    if (context?.restoreFocus === false) return;
    const triggerVisible = returnFocus instanceof HTMLElement && returnFocus.isConnected
      && (returnFocus.checkVisibility?.() ?? returnFocus.getClientRects().length > 0);
    if (triggerVisible) {
      returnFocus.focus({ preventScroll: true });
    } else if (mobile.matches && document.body.dataset.mobileView === 'map') {
      byId('map').focus({ preventScroll: true });
    } else {
      (attractionList.querySelector('button') || searchInput).focus({ preventScroll: true });
    }
  });
  byId('explore-button').addEventListener('click', () => {
    returnFocus = byId('map');
    closeAttraction();
    focusSelectedOnMap();
  });
  byId('share-place')?.addEventListener('click', shareSelectedPlace);
  byId('previous-place')?.addEventListener('click', (event) => navigatePlaces(-1, event.currentTarget));
  byId('next-place')?.addEventListener('click', (event) => navigatePlaces(1, event.currentTarget));
  card.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    navigatePlaces(event.key === 'ArrowRight' ? 1 : -1);
  });
  [card, byId('info-dialog')].forEach((dialog) => {
    dialog.addEventListener('keydown', (event) => {
      if (dialog === card && !card.matches(':modal')) return;
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), details > summary, [tabindex="0"]')]
        .filter((element) => !element.closest('[hidden]')
          && (element.checkVisibility?.() ?? element.getClientRects().length > 0));
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !controls.includes(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
        event.preventDefault();
        first?.focus();
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        if (dialog === card) closeAttraction();
        else dialog.close();
      }
    });
  });
  ['about-button', 'map-about-button'].forEach((id) => byId(id).addEventListener('click', () => byId('info-dialog').showModal()));
  byId('info-close').addEventListener('click', () => byId('info-dialog').close());
  byId('info-dialog').addEventListener('close', syncCardPresentation);
  byId('view-map').addEventListener('click', () => setMobileView('map'));
  byId('view-list').addEventListener('click', () => setMobileView('list'));
  byId('fit-map').addEventListener('click', fitResults);
  byId('zoom-in').addEventListener('click', () => map?.zoomIn());
  byId('zoom-out').addEventListener('click', () => map?.zoomOut());
  const retryMap = () => map ? loadMapTiles() : prepareMap();
  byId('retry-map').addEventListener('click', retryMap);
  window.addEventListener('online', () => { if (!byId('map-status').hidden) retryMap(); });

  byId('theme-toggle').addEventListener('click', () => {
    hasThemePreference = true;
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem(THEME_STORAGE_KEY, currentTheme); } catch { /* Theme still works for this session. */ }
  });
  systemTheme.addEventListener('change', (event) => {
    if (!hasThemePreference) applyTheme(event.matches ? 'dark' : 'light');
  });
  mobile.addEventListener('change', syncCardPresentation);

  attractionList.addEventListener('pointerover', (event) => {
    const button = event.target.closest('.attraction-list-button');
    if (!button) return;
    hoveredPlaceId = button.dataset.placeId;
    highlightSelection();
  });
  attractionList.addEventListener('pointerout', (event) => {
    const button = event.target.closest('.attraction-list-button');
    if (!button || button.contains(event.relatedTarget)) return;
    hoveredPlaceId = null;
    highlightSelection();
  });
  attractionList.addEventListener('focusin', (event) => {
    focusedPlaceId = event.target.closest('.attraction-list-button')?.dataset.placeId || null;
    highlightSelection();
  });
  attractionList.addEventListener('focusout', (event) => {
    focusedPlaceId = event.relatedTarget?.closest?.('.attraction-list-button')?.dataset.placeId || null;
    highlightSelection();
  });

  attractionList.addEventListener('keydown', (event) => {
    const button = event.target.closest('.attraction-list-button');
    if (!button || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...attractionList.querySelectorAll('.attraction-list-button')];
    let index = buttons.indexOf(button);
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = buttons.length - 1;
    if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[index].focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && card.open && !card.matches(':modal') && !byId('info-dialog').open) {
      event.preventDefault();
      closeAttraction();
    }
    if (event.key === '/' && !card.matches(':modal') && !byId('info-dialog').open
      && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      hasThemePreference = ['light', 'dark'].includes(event.newValue);
      applyTheme(hasThemePreference ? event.newValue : (systemTheme.matches ? 'dark' : 'light'));
    }
    if (event.key !== FAVORITES_STORAGE_KEY && event.key !== null) return;
    try {
      const saved = JSON.parse(event.newValue || '[]');
      favoriteIds = new Set(Array.isArray(saved) ? saved.filter((id) => attractionIds.has(id)) : []);
      filterMarkers();
    } catch { /* Ignore malformed updates from another tab. */ }
  });
  window.addEventListener('hashchange', openLinkedPlace);

  findMeButton.addEventListener('click', () => {
    if (!map || locationRequestInProgress) return;
    if (!window.isSecureContext) {
      showLocationStatus('Для геолокации откройте приложение по HTTPS или на localhost.');
      return;
    }
    if (!navigator.geolocation) {
      showLocationStatus('Браузер не поддерживает геолокацию. Используйте поиск по карте.');
      return;
    }
    const revision = ++locationRevision;
    locationRequestInProgress = true;
    findMeButton.disabled = true;
    findMeButton.setAttribute('aria-busy', 'true');
    showLocationStatus('Определяем ваше местоположение…', 0);
    locationTimeout = setTimeout(() => {
      if (revision !== locationRevision) return;
      locationRevision += 1;
      handleLocationError({ code: 3 });
    }, 14000);
    try {
      navigator.geolocation.getCurrentPosition((position) => {
        if (revision !== locationRevision) return;
        finishLocationRequest();
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          handleLocationError({ code: 2 });
          return;
        }
        const point = [latitude, longitude];
        if (userMarker) map.removeLayer(userMarker);
        if (accuracyCircle) map.removeLayer(accuracyCircle);
        userMarker = L.circleMarker(point, { radius: 8, color: '#ffffff', weight: 3,
          fillColor: '#2563eb', fillOpacity: 1, className: 'user-location-marker' }).addTo(map);
        userMarker.bindTooltip('Вы здесь');
        if (Number.isFinite(accuracy) && accuracy > 0) accuracyCircle = L.circle(point, {
          radius: accuracy, color: '#2563eb', weight: 1, fillOpacity: .08, interactive: false
        }).addTo(map);
        map.setView(point, 15, { animate: !reducedMotion.matches });
        const outsideCity = L.latLng(point).distanceTo([51.128, 71.434]) > 35000;
        showLocationStatus(outsideCity
          ? 'Вы за пределами Астаны. Кнопка «Показать все найденные места» вернёт вас к подборке.'
          : 'Вы на карте. Точность зависит от устройства.', 8500);
      }, (error) => {
        if (revision === locationRevision) handleLocationError(error);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } catch (error) { handleLocationError(error); }
  });

  async function loadMapLibrary(url) {
    let timeout;
    try {
      return await Promise.race([
        import(url).then(() => true, () => false),
        new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 4000); })
      ]);
    } finally { clearTimeout(timeout); }
  }

  async function prepareMap() {
    if (map || mapInitializing) return;
    mapInitializing = true;
    const retrySuffix = mapLoadAttempt++ ? `?retry=${mapLoadAttempt}` : '';
    byId('map').setAttribute('aria-busy', 'true');
    setMapStatus('Загружаем карту…');
    document.querySelectorAll('.map-controls button').forEach((button) => { button.disabled = true; });
    byId('explore-button').disabled = true;
    if (!window.L) await loadMapLibrary(`./vendor/leaflet/leaflet.js${retrySuffix}`);
    if (window.L && !L.markerClusterGroup) await loadMapLibrary(`./vendor/leaflet.markercluster/leaflet.markercluster.js${retrySuffix}`);
    initializeMap();
    filterMarkers();
    if (map) {
      document.querySelectorAll('.map-controls button').forEach((button) => { button.disabled = false; });
      byId('explore-button').disabled = false;
      byId('map').setAttribute('aria-label', 'Интерактивная карта Астаны. Стрелки — перемещение, плюс и минус — масштаб.');
      selectedMarker = markersById.get(selectedAttraction?.id);
      selectedMarker?.setZIndexOffset(1000);
      highlightSelection();
      if (card.open && !mobile.matches) revealSelectedOnMap();
    }
    byId('map').setAttribute('aria-busy', 'false');
    mapInitializing = false;
  }
  openLinkedPlace();
  await prepareMap();
})();
