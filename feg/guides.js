/*
 * Fried Egg Golf — Guides Template script (/guides/<slug>)
 *
 * Forked 2026-09-10 from Neon-Hive/webflow feg/guides.js (commit 2026-01-13).
 * Behaviour is unchanged except for these fixes:
 *
 *  1. Boot no longer depends on a DOMContentLoaded listener that can register
 *     after the event has already fired (the script is loaded async at the end
 *     of <body>, so on fast connections the page stayed on skeletons forever).
 *  2. Ordering + reveal of the guide items runs FIRST and synchronously, and no
 *     longer waits for Google Maps. The map fills in afterwards; if Maps fails
 *     (blocked / offline) the article still shows.
 *  3. Content Ordering tokens are normalised (zero-width characters, case,
 *     whitespace) before matching, and an empty field no longer throws.
 *  4. The enlarged/mobile map panel links to the course's real profile page
 *     (read from the card's "Find out more" link) instead of building a URL
 *     from the guide-course slug, which 404'd for ~60% of courses.
 *  5. `mapExploreBadge` was referenced but never declared (ReferenceError on
 *     every Explore item in the map panel); badges are now switched by type.
 */
(() => {
	"use strict";

	// Slugs must match exactly; editors paste {{slug}} tokens into a rich text
	// field, which picks up zero-width spaces and capital letters.
	function normaliseSlug(value) {
		return String(value || "")
			.replace(/[^a-z0-9-]/gi, "")
			.toLowerCase();
	}

	// Course cards bind "Find out more" through the referenced Course profile,
	// so the card href is the only reliable source of the profile URL.
	function getCourseProfileHref(slug) {
		const card = document.querySelector(
			`[data-guide-item='true'][data-slug='${CSS.escape(slug)}']`,
		);
		const link = card && card.querySelector("a[href^='/courses/']");
		return link ? link.getAttribute("href") : null;
	}

	// ### Guide items ordering + reveal (runs before anything async)
	function orderAndRevealGuideItems() {
		try {
			const guideItemAppend = document.querySelector("[data-guide-append]");
			const guideOrderingMatch = document.querySelector("[data-guide-ordering]");
			const allGuideItems = Array.from(
				document.querySelectorAll("[data-guide-item='true']"),
			);
			if (!guideItemAppend || allGuideItems.length === 0) return;

			const tokens =
				((guideOrderingMatch && guideOrderingMatch.textContent) || "").match(
					/{{(.*?)}}/g,
				) || [];
			const rank = new Map();
			tokens.forEach((token) => {
				const slug = normaliseSlug(token.replace(/{{|}}/g, ""));
				if (slug && !rank.has(slug)) rank.set(slug, rank.size);
			});

			const matchedItems = [];
			const unmatchedItems = [];
			allGuideItems.forEach((item) => {
				(rank.has(normaliseSlug(item.dataset.slug))
					? matchedItems
					: unmatchedItems
				).push(item);
			});
			matchedItems.sort(
				(a, b) =>
					rank.get(normaliseSlug(a.dataset.slug)) -
					rank.get(normaliseSlug(b.dataset.slug)),
			);

			guideItemAppend.innerHTML = "";
			matchedItems.forEach((item) => guideItemAppend.appendChild(item));
			unmatchedItems.forEach((item) => guideItemAppend.appendChild(item));
		} catch (error) {
			console.error("[guides] ordering failed, showing items in CMS order", error);
		} finally {
			document
				.querySelectorAll(".guide_loading-skeletons")
				.forEach((loader) => loader.remove());
			document.documentElement.classList.add("guides-js-ready");
		}
	}

	async function initMap(mapElemId = "guide-map") {
		// Request needed libraries.
		const { Map } = await google.maps.importLibrary("maps");
		const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
		const mapElem = document.getElementById(mapElemId);

		// Map content module elements and arrow buttons
		const mapEnlargedViewWrapper = document.querySelector(
			".guide_map-enlarge-view",
		);
		const mapModule = document.querySelector("#mapModule");
		const mapNextBtn = document.getElementById("mapNext");
		const mapPrevBtn = document.getElementById("mapPrev");

		const mapModuleImage = mapModule.querySelector("[data-map-module='image']");
		const mapModuleTitle = mapModule.querySelector("[data-map-module='title']");
		const mapModuleLink = mapModule.querySelector("[data-map-module='link']");

		// Only for courses
		const accessAndPriceContainer = document.querySelector(
			'[data-map-module="container"]',
		);
		const mapModulePrice = mapModule.querySelector("[data-map-module='price']");
		const mapModuleAccess = mapModule.querySelector(
			"[data-map-module='access']",
		);

		// Badges
		const badges = {
			Course: mapModule.querySelector("[data-map-module='course']"),
			Stay: mapModule.querySelector("[data-map-module='stay']"),
			Eat: mapModule.querySelector("[data-map-module='eat']"),
			Explore: mapModule.querySelector("[data-map-module='explore']"),
		};

		function showBadge(type) {
			Object.entries(badges).forEach(([badgeType, badge]) => {
				if (badge) badge.style.display = badgeType === type ? "flex" : "none";
			});
		}

		// Navigation state for enlarged view
		let currentModuleIndex = 0;
		let filteredMapItems = [];

		// Function to decode HTML entities
		function decodeHtmlEntities(text) {
			const textarea = document.createElement("textarea");
			textarea.innerHTML = text;
			return textarea.value;
		}

		// Function to get currently visible map items based on filter
		function getFilteredMapItems() {
			return mapItems.filter((item) => {
				const marker = markers[item.slug];
				return marker && marker.getVisible();
			});
		}

		// Initialize module with first available item
		function initializeMapModule() {
			filteredMapItems = getFilteredMapItems();
			currentModuleIndex = 0;

			if (filteredMapItems.length > 0) {
				updateMapModule(filteredMapItems[0]);
			}
			updateNavigationButtons();
		}

		// initialize map module without panning to the first item
		function initializeMapModuleWithoutPanning() {
			filteredMapItems = getFilteredMapItems();
			currentModuleIndex = 0;

			if (filteredMapItems.length > 0) {
				updateMapModuleWithoutPanning(filteredMapItems[0]);
			}
			updateNavigationButtons();
		}

		// Function to scroll to and highlight content item
		function scrollToContentItem(slug) {
			const contentItem = document.querySelector(
				`[data-guide-item='true'][data-slug='${slug}']`,
			);
			if (
				contentItem &&
				contentItem.style.display !== "none" &&
				!contentItem.classList.contains("filtered-out")
			) {
				// Remove active class from all items
				document
					.querySelectorAll("[data-guide-item='true']")
					.forEach((item) => {
						item.classList.remove("map-active");
					});

				// Add active class to target item
				contentItem.classList.add("map-active");

				// Smooth scroll to the item with offset for better visibility
				const itemRect = contentItem.getBoundingClientRect();
				const scrollTop =
					window.pageYOffset || document.documentElement.scrollTop;
				const targetPosition = scrollTop + itemRect.top - 100; // 100px offset from top

				window.scrollTo({
					top: targetPosition,
					behavior: "smooth",
				});

				console.log(`Scrolled to content item: ${slug}`);
			}
		}

		// Function to update map module and find current index
		function updateMapModuleForSlug(slug) {
			const mapItem = mapItems.find((item) => item.slug === slug);
			if (mapItem && isMapEnlarged) {
				filteredMapItems = getFilteredMapItems();
				currentModuleIndex = filteredMapItems.findIndex(
					(item) => item.slug === slug,
				);
				if (currentModuleIndex === -1) currentModuleIndex = 0;

				updateMapModule(mapItem);
				updateNavigationButtons();
			}
		}

		// Map controls and layout
		const mapWrapper = document.querySelector(".guide_map");
		const mapEnlargeBtn = document.getElementById("mapEnlarge");
		const mapShrinkBtn = document.getElementById("mapShrink");
		const mapVectorBtn = document.getElementById("mapVector");
		const mapSatelliteBtn = document.getElementById("mapSatellite");
		const mapZoomInBtn = document.getElementById("mapZoomIn");
		const mapZoomOutBtn = document.getElementById("mapZoomOut");

		// Handle toggling map to larger view
		let isMapEnlarged = false;
		mapEnlargeBtn.addEventListener("click", () => {
			if (!isMapEnlarged) {
				mapWrapper.classList.remove("sticky");
				mapWrapper.classList.add("enlarged");

				// Initialize the map module when entering enlarged view
				initializeMapModule();
			}
			isMapEnlarged = !isMapEnlarged;
		});

		// Handle shrinking the map view
		mapShrinkBtn.addEventListener("click", () => {
			if (isMapEnlarged) {
				mapWrapper.classList.add("sticky");
				mapWrapper.classList.remove("enlarged");
			}
			isMapEnlarged = !isMapEnlarged;
		});

		// Handle changing map to vector
		mapVectorBtn.addEventListener("click", () => {
			mapVectorBtn.classList.add("is-active");
			mapSatelliteBtn.classList.remove("is-active");
			map.setMapTypeId("roadmap");
		});

		// Handle changing map to satellite
		mapSatelliteBtn.addEventListener("click", () => {
			mapVectorBtn.classList.remove("is-active");
			mapSatelliteBtn.classList.add("is-active");
			map.setMapTypeId("satellite");
		});

		// Handle Map zoom in
		mapZoomInBtn.addEventListener("click", () => {
			map.setZoom(map.getZoom() + 1);
		});

		// Handle Map zoom out
		mapZoomOutBtn.addEventListener("click", () => {
			map.setZoom(map.getZoom() - 1);
		});

		// Shared between the panning and non-panning module updates
		function fillMapModule(mapItem) {
			// Update module content
			if (mapModuleImage) {
				mapModuleImage.src = mapItem.image || "";
				mapModuleImage.alt = mapItem.name || "";
			}

			if (mapModuleTitle) {
				mapModuleTitle.textContent = decodeHtmlEntities(mapItem.name || "");
			}

			showBadge(mapItem.type);

			if (mapModuleLink) {
				let href = null;

				if (mapItem.type === "Course") {
					// Only courses with a linked profile get a link
					href = getCourseProfileHref(mapItem.slug);
				} else if (mapItem.link && mapItem.link.trim() !== "") {
					// For Stay/Eat/Explore, only show if there's a valid link.
					// The embed HTML-escapes the URL ("&amp;"), so decode it.
					href = decodeHtmlEntities(mapItem.link.trim());
				}

				// Show/hide the link element
				if (href) {
					mapModuleLink.href = href;
					mapModuleLink.style.display = "";
					mapModuleLink.style.visibility = "visible";
				} else {
					mapModuleLink.style.display = "none";
					mapModuleLink.style.visibility = "hidden";
				}
			}

			// Handle course-specific elements (price and access)
			const hasPriceData =
				mapItem.type === "Course" &&
				mapItem.price &&
				mapItem.price.trim() !== "";
			if (mapModulePrice) {
				if (hasPriceData) {
					mapModulePrice.textContent = mapItem.price;
					mapModulePrice.style.display = "";
					mapModulePrice.style.visibility = "visible";
				} else {
					mapModulePrice.style.display = "none";
					mapModulePrice.style.visibility = "hidden";
				}
			}

			const hasAccessData =
				mapItem.type === "Course" &&
				mapItem.access &&
				mapItem.access.trim() !== "";
			if (mapModuleAccess) {
				if (hasAccessData) {
					mapModuleAccess.textContent = mapItem.access;
					mapModuleAccess.style.display = "";
					mapModuleAccess.style.visibility = "visible";
				} else {
					mapModuleAccess.style.display = "none";
					mapModuleAccess.style.visibility = "hidden";
				}
			}

			// Hide container if no price or access
			if (hasPriceData || hasAccessData) {
				accessAndPriceContainer.style.display = "";
				accessAndPriceContainer.style.visibility = "visible";
			} else {
				accessAndPriceContainer.style.display = "none";
				accessAndPriceContainer.style.visibility = "hidden";
			}
		}

		// Function to update the map module content
		function updateMapModule(mapItem) {
			if (!mapItem) return;

			fillMapModule(mapItem);

			// Update map focus
			const marker = markers[mapItem.slug];
			if (marker) {
				const position = marker.getPosition();
				butterySmoothPanAndZoom(position.lat(), position.lng(), 13, 800); // only want to be a lil bit zoomed in than default

				// Animate marker
				Object.values(markers).forEach((m) => m.setAnimation(null));
				marker.setAnimation(google.maps.Animation.BOUNCE);
				setTimeout(() => {
					if (marker.getAnimation() !== null) {
						marker.setAnimation(null);
					}
				}, 1000);
			}

			console.log(`Map module updated for: ${mapItem.slug}`);
		}

		//update map module content without panning/zooming
		function updateMapModuleWithoutPanning(mapItem) {
			if (!mapItem) return;

			fillMapModule(mapItem);

			console.log(`Map module updated (without panning) for: ${mapItem.slug}`);
		}

		// Function to navigate to next marker
		function navigateToNext() {
			if (filteredMapItems.length === 0) return;

			currentModuleIndex = (currentModuleIndex + 1) % filteredMapItems.length;
			updateMapModule(filteredMapItems[currentModuleIndex]);
			updateNavigationButtons();
		}

		// Function to navigate to previous marker
		function navigateToPrev() {
			if (filteredMapItems.length === 0) return;

			currentModuleIndex =
				currentModuleIndex === 0
					? filteredMapItems.length - 1
					: currentModuleIndex - 1;
			updateMapModule(filteredMapItems[currentModuleIndex]);
			updateNavigationButtons();
		}

		// Function to update navigation button states
		function updateNavigationButtons() {
			if (!mapNextBtn || !mapPrevBtn) return;

			// Show/hide buttons based on available items
			if (filteredMapItems.length <= 1) {
				mapNextBtn.style.display = "none";
				mapPrevBtn.style.display = "none";
			} else {
				mapNextBtn.style.display = "flex";
				mapPrevBtn.style.display = "flex";
			}

			// Add visual indicators for first/last items
			mapPrevBtn.classList.toggle("disabled", currentModuleIndex === 0);
			mapNextBtn.classList.toggle(
				"disabled",
				currentModuleIndex === filteredMapItems.length - 1,
			);
		}

		// Mobile list / map toggle
		const mobileListViewBtn = document.querySelector("#guideMobileList");
		const mobileMapViewBtn = document.querySelector("#guideMobileMap");

		// Mobile: Toggle list view
		mobileListViewBtn.addEventListener("click", () => {
			isMapEnlarged = false;
		});

		// Mobile: Toggle map view
		mobileMapViewBtn.addEventListener("click", () => {
			isMapEnlarged = true;
			// Initialize the map module when entering map view
			initializeMapModule();
		});

		// Mobile / Enlarged: Add event listeners for navigation buttons
		if (mapNextBtn) {
			mapNextBtn.addEventListener("click", navigateToNext);
		}

		if (mapPrevBtn) {
			mapPrevBtn.addEventListener("click", navigateToPrev);
		}

		// Global filter state
		let currentFilter = "all";

		// Function to sync filter button states
		function syncFilterButtons(activeFilter) {
			const allFilterBtns = document.querySelectorAll("[data-filter]");

			// On mobile show current filter
			if (activeFilter) {
				mobileFilterText.forEach((text) => {
					text.innerHTML = `Filter: <span class="is-active">${activeFilter}</span>`;
				});
			}

			allFilterBtns.forEach((btn) => {
				const filterValue = btn.dataset.filter;
				btn.classList.remove("is-active");
				if (filterValue === activeFilter) {
					btn.classList.add("is-active");
				}
			});
		}

		// Function to filter content items
		function filterContentItems(filterValue) {
			const allGuideItems = document.querySelectorAll(
				"[data-guide-item='true']",
			);

			allGuideItems.forEach((item) => {
				const itemType = item.dataset.type;

				if (filterValue === "all" || itemType === filterValue) {
					item.style.display = "";
					item.classList.remove("filtered-out");
				} else {
					item.style.display = "none";
					item.classList.add("filtered-out");
				}
			});
		}

		// Function to calculate average location of all markers
		function getAverageMarkerLocation() {
			const allMarkerPositions = [];
			Object.values(markers).forEach((marker) => {
				const position = marker.getPosition();
				allMarkerPositions.push({
					lat: position.lat(),
					lng: position.lng(),
				});
			});

			if (allMarkerPositions.length === 0) {
				// Fallback to USA center if no markers exist at all
				return { lat: 39.8283, lng: -98.5795 };
			}

			// Calculate average
			const avgLat =
				allMarkerPositions.reduce((sum, pos) => sum + pos.lat, 0) /
				allMarkerPositions.length;
			const avgLng =
				allMarkerPositions.reduce((sum, pos) => sum + pos.lng, 0) /
				allMarkerPositions.length;

			return { lat: avgLat, lng: avgLng };
		}

		// Function to filter map markers
		function filterMapMarkers(filterValue) {
			const visibleMarkers = [];
			const bounds = new google.maps.LatLngBounds();

			Object.entries(markers).forEach(([slug, marker]) => {
				const mapItem = mapItems.find((item) => item.slug === slug);
				if (!mapItem) return;

				if (filterValue === "all" || mapItem.type === filterValue) {
					marker.setMap(map);
					marker.setVisible(true);
					visibleMarkers.push(marker);
					bounds.extend(marker.getPosition());
				} else {
					marker.setMap(null);
					marker.setVisible(false);
				}
			});

			if (visibleMarkers.length > 0) {
				if (visibleMarkers.length === 1) {
					// For single markers, center but don't zoom too close
					const position = visibleMarkers[0].getPosition();
					map.setCenter({ lat: position.lat(), lng: position.lng() });
					map.setZoom(14);
				} else {
					// For multiple markers, use fitBounds (same as initial load and scroll)
					if (!bounds.isEmpty()) {
						// Use fitBounds with padding to ensure all markers are visible
						map.fitBounds(bounds, {
							top: 50,
							right: 50,
							bottom: 50,
							left: 50,
						});

						// Limit max zoom to ensure we don't zoom in too much
						setTimeout(() => {
							const currentZoom = map.getZoom();
							if (currentZoom > 10) {
								map.setZoom(10);
							}
						}, 100);
					}
				}
			} else {
				// No visible markers - use average location of all plotted markers
				const avgLocation = getAverageMarkerLocation();
				map.setCenter({ lat: avgLocation.lat, lng: avgLocation.lng });
				map.setZoom(10);
			}
		}

		// Enhanced filter application function
		function applyMapFilter(filterValue) {
			console.log(`Applying map filter: ${filterValue}`);

			currentFilter = filterValue;
			syncFilterButtons(filterValue);
			filterContentItems(filterValue);
			filterMapMarkers(filterValue);

			// Reset current active item since content might have changed
			currentActiveSlug = null;
			document.querySelectorAll("[data-guide-item='true']").forEach((item) => {
				item.classList.remove("map-active");
			});

			// Update module if in enlarged view
			if (isMapEnlarged) {
				initializeMapModuleWithoutPanning();
			}
		}

		// Handle map filters for both regular and enlarged views
		const mapFilterBtns = document.querySelectorAll("[data-filter]");
		mapFilterBtns.forEach((btn) => {
			btn.addEventListener("click", () => {
				const filterValue = btn.dataset.filter;
				applyMapFilter(filterValue);

				if (mobileFiltersOpen) {
					closeMobileFilters();
				}
			});
		});

		// Add keyboard navigation support
		document.addEventListener("keydown", (event) => {
			if (isMapEnlarged) {
				if (event.key === "ArrowRight" || event.key === "ArrowDown") {
					event.preventDefault();
					navigateToNext();
				} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
					event.preventDefault();
					navigateToPrev();
				}
			}
		});

		// ### Initialize the map
		const mapOptions = {
			mapId: "c0e1c832f5f11b41ba746cf8",
			zoom: 10,
			center: { lat: 39.8283, lng: -98.5795 }, // Center of USA
			gestureHandling: window.innerWidth <= 425 ? "greedy" : "auto",
			disableDefaultUI: true,
			zoomControl: false,
			streetViewControl: false,
			mapTypeControl: false,
			fullscreenControl: false,
			rotateControl: false,
			scaleControl: false,
		};

		console.log("Initialising the map:", mapElemId);
		const map = new google.maps.Map(mapElem, mapOptions);
		window.map = map; // make map global

		// Custom marker icons
		const markerIcons = {
			Eat: {
				url: "https://cdn.prod.website-files.com/67ab6ef769ff843db623d6f5/689eb596bbb24ca62e18b198_eat-icon.svg",
			},
			Stay: {
				url: "https://cdn.prod.website-files.com/67ab6ef769ff843db623d6f5/689eb59629bee07dae592c97_stay-icon.svg",
			},
			Explore: {
				url: "https://cdn.prod.website-files.com/67ab6ef769ff843db623d6f5/6913c01e6b3f268e781254e8_explore-icon.svg",
			},
			Course: {
				url: "https://cdn.prod.website-files.com/67ab6ef769ff843db623d6f5/689eb596353ab56c0e69d870_play-icon.svg",
			},
		};

		const markers = {};

		// Create markers
		mapItems.forEach((item) => {
			if (!item.lat || !item.lng) return;

			const position = {
				lat: Number.parseFloat(item.lat),
				lng: Number.parseFloat(item.lng),
			};

			const marker = new google.maps.Marker({
				position: position,
				map: map,
				icon: markerIcons[item.type] || null,
				title: item.type,
			});

			// Allow clicking on marker and changing the map module (if visible)
			marker.addListener("click", () => {
				// Update current active slug
				currentActiveSlug = item.slug;

				// Update map module if in enlarged view
				updateMapModuleForSlug(item.slug);

				// Scroll to and highlight the content item
				scrollToContentItem(item.slug);

				// Center map on clicked marker with zoom
				butterySmoothPanAndZoom(position.lat, position.lng, 15, 800);

				// Animate the clicked marker
				Object.values(markers).forEach((m) => m.setAnimation(null));
				marker.setAnimation(google.maps.Animation.BOUNCE);
				setTimeout(() => {
					if (marker.getAnimation() !== null) {
						marker.setAnimation(null);
					}
				}, 1000);
			});

			markers[item.slug] = marker;
		});

		// Animation state tracking
		let currentAnimation = null;
		let currentActiveSlug = null;

		// Easing function for smooth animation
		function easeInOutCubic(t) {
			return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		}

		// Ultra smooth pan and zoom using requestAnimationFrame
		function butterySmoothPanAndZoom(
			targetLat,
			targetLng,
			targetZoom,
			duration = 800,
		) {
			if (currentAnimation) {
				cancelAnimationFrame(currentAnimation);
			}

			const startTime = performance.now();
			const startCenter = map.getCenter();
			const startZoom = map.getZoom();

			const startLat = startCenter.lat();
			const startLng = startCenter.lng();

			const latDiff = targetLat - startLat;
			const lngDiff = targetLng - startLng;
			const zoomDiff = targetZoom - startZoom;

			function animate(currentTime) {
				const elapsed = currentTime - startTime;
				const progress = Math.min(elapsed / duration, 1);
				const easedProgress = easeInOutCubic(progress);

				const currentLat = startLat + latDiff * easedProgress;
				const currentLng = startLng + lngDiff * easedProgress;
				const currentZoom = startZoom + zoomDiff * easedProgress;

				map.setCenter({ lat: currentLat, lng: currentLng });
				map.setZoom(currentZoom);

				if (progress < 1) {
					currentAnimation = requestAnimationFrame(animate);
				} else {
					currentAnimation = null;
				}
			}

			currentAnimation = requestAnimationFrame(animate);
		}

		// Function to check if an element is in viewport
		function isInViewport(element, threshold = 0.5) {
			const rect = element.getBoundingClientRect();
			const viewportHeight = window.innerHeight;

			const visibleTop = Math.max(0, rect.top);
			const visibleBottom = Math.min(viewportHeight, rect.bottom);
			const visibleHeight = Math.max(0, visibleBottom - visibleTop);
			const elementHeight = rect.height;

			return visibleHeight / elementHeight >= threshold;
		}

		// Enhanced function to get the most prominent item in viewport
		function getMostProminentItem() {
			// Only consider visible items (not filtered out)
			const mapItemList = document.querySelectorAll(
				"[data-guide-item='true']:not(.filtered-out)",
			);
			const viewportCenter = window.innerHeight / 2;
			let bestItem = null;
			let bestScore = -1;

			mapItemList.forEach((item) => {
				// Skip items not in viewport or that are hidden
				if (!isInViewport(item, 0.3) || item.style.display === "none") return;

				const rect = item.getBoundingClientRect();
				const itemCenter = rect.top + rect.height / 2;

				const visibilityScore = isInViewport(item, 0) ? 1 : 0;
				const centerDistance = Math.abs(itemCenter - viewportCenter);
				const maxDistance = window.innerHeight / 2;
				const centerScore = 1 - centerDistance / maxDistance;

				const totalScore = visibilityScore * 0.7 + centerScore * 0.3;

				if (totalScore > bestScore) {
					bestScore = totalScore;
					bestItem = item;
				}
			});

			return bestItem;
		}

		// Throttle function for better performance
		function throttle(func, limit) {
			let inThrottle;
			return function () {
				const args = arguments;
				if (!inThrottle) {
					func.apply(this, args);
					inThrottle = true;
					setTimeout(() => (inThrottle = false), limit);
				}
			};
		}

		// Debounce function to prevent rapid firing
		function debounce(func, wait) {
			let timeout;
			return function executedFunction(...args) {
				const later = () => {
					clearTimeout(timeout);
					func(...args);
				};
				clearTimeout(timeout);
				timeout = setTimeout(later, wait);
			};
		}

		// Main scroll handler
		function handleScroll() {
			const prominentItem = getMostProminentItem();

			if (!prominentItem) {
				// No item in focus, fit all visible markers
				if (currentActiveSlug !== null) {
					currentActiveSlug = null;

					// Remove active class from all items
					document
						.querySelectorAll("[data-guide-item='true']")
						.forEach((item) => {
							item.classList.remove("map-active");
						});

					// Stop any marker animations
					Object.values(markers).forEach((m) => m.setAnimation(null));

					// Fit all visible markers in view using fitBounds (same as initial load)
					const visibleMarkers = Object.values(markers).filter((marker) =>
						marker.getVisible(),
					);

					if (visibleMarkers.length > 1) {
						const bounds = new google.maps.LatLngBounds();
						visibleMarkers.forEach((marker) => {
							bounds.extend(marker.getPosition());
						});

						if (!bounds.isEmpty()) {
							// Use fitBounds with padding to ensure all markers are visible
							map.fitBounds(bounds, {
								top: 50,
								right: 50,
								bottom: 50,
								left: 50,
							});

							// Limit max zoom to ensure we don't zoom in too much
							setTimeout(() => {
								const currentZoom = map.getZoom();
								if (currentZoom > 10) {
									map.setZoom(10);
								}
							}, 100);
						}
					}
				}
				return;
			}

			const slug = prominentItem.dataset.slug;

			if (slug && slug !== currentActiveSlug) {
				currentActiveSlug = slug;
				const marker = markers[slug];

				// Check if marker is visible (not filtered out)
				if (marker && marker.getVisible()) {
					const position = marker.getPosition();
					const targetLat = position.lat();
					const targetLng = position.lng();

					// Update visual state of list items
					document
						.querySelectorAll("[data-guide-item='true']")
						.forEach((item) => {
							item.classList.remove("map-active");
						});
					prominentItem.classList.add("map-active");

					butterySmoothPanAndZoom(targetLat, targetLng, 14, 600); // ZOom in when we scroll on the item

					Object.values(markers).forEach((m) => m.setAnimation(null));

					marker.setAnimation(google.maps.Animation.BOUNCE);
					setTimeout(() => {
						if (marker.getAnimation() !== null) {
							marker.setAnimation(null);
						}
					}, 750);
				}
			}
		}

		const throttledScrollHandler = throttle(handleScroll, 100);

		window.addEventListener("scroll", throttledScrollHandler);
		window.addEventListener("resize", debounce(handleScroll, 250));

		// Initialize with 'all' filter
		setTimeout(() => {
			applyMapFilter("all");

			// Use fitBounds to show all pins properly
			setTimeout(() => {
				const visibleMarkers = Object.values(markers).filter((marker) =>
					marker.getVisible(),
				);

				if (visibleMarkers.length > 1) {
					const bounds = new google.maps.LatLngBounds();
					visibleMarkers.forEach((marker) => {
						bounds.extend(marker.getPosition());
					});

					if (!bounds.isEmpty()) {
						// Use fitBounds with padding to ensure all markers are visible
						map.fitBounds(bounds, {
							top: 50,
							right: 50,
							bottom: 50,
							left: 50,
						});

						// Limit max zoom to ensure we don't zoom in too much
						setTimeout(() => {
							const currentZoom = map.getZoom();
							if (currentZoom > 10) {
								map.setZoom(10);
							}
						}, 100);
					}
				}
			}, 200);
		}, 500);
	}

	// ### Header image carousel code (independent of the map)
	function initHeaderCarousel() {
		const guideHeaderImages = document.querySelectorAll(
			"[data-guide-header-image]",
		);
		const guideHeaderProgressWrapper = document.querySelector(
			"[data-guide-header-progress]",
		);
		const progressTemplate =
			guideHeaderProgressWrapper &&
			guideHeaderProgressWrapper.querySelector(".guide_progress");
		if (!guideHeaderImages.length || !progressTemplate) return;

		// Remove the original template item
		progressTemplate.remove();

		// Clone the progress bar for each image
		guideHeaderImages.forEach(() => {
			const progressIndicator = progressTemplate.cloneNode(true);
			progressIndicator.classList.remove("u-hide");
			guideHeaderProgressWrapper.appendChild(progressIndicator);
		});

		const progressIndicators = guideHeaderProgressWrapper.querySelectorAll(
			".guide_progress-bar",
		);

		let currentIndex = 0;

		function updateActiveImage() {
			// Hide all images and reset progress indicators
			guideHeaderImages.forEach((img, index) => {
				img.classList.remove("is-active");
				progressIndicators[index].style.transition = "none";
				progressIndicators[index].style.width = "0%";
			});

			// Show the current image and update its progress indicator
			guideHeaderImages[currentIndex].classList.add("is-active");

			setTimeout(() => {
				progressIndicators[currentIndex].style.transition = "width 10s linear";
				progressIndicators[currentIndex].style.width = "100%";
			}, 50);

			// Move to the next image
			currentIndex = (currentIndex + 1) % guideHeaderImages.length;
		}

		// Start the loop
		setInterval(updateActiveImage, 10000);
		updateActiveImage();
	}

	// Enlarged layout change - Map and layout - this needed to be outside of map Init due to mutate conflict
	let mobileFiltersOpen = false;
	let closeMobileFilters = () => {};
	let mobileFilterText = [];

	function initLayoutAndMobileControls() {
		const mapCloseBtn = document.getElementById("mapClose");
		const mapOpenBtn = document.getElementById("mapOpen");
		const mapEnlargeBtn = document.getElementById("mapEnlarge");
		const mapShrinkBtn = document.getElementById("mapShrink");

		// Map and body wrappers
		const guideMainLayout = document.querySelector(".guide_main-layout");
		const guideMap = document.querySelector(".guide_map");
		const guideMapWrapper = document.querySelector(".guide_map-wrap");
		const guideBodyWrapper = document.querySelector(".guide_body-wrap");
		const gridEls = [guideMapWrapper, guideBodyWrapper];

		// Animate our grids
		function flipMove(elements, mutate, onDone) {
			if (!Array.isArray(elements) || !elements.length) {
				mutate?.();
				onDone?.();
				return;
			}
			const first = new Map(
				elements.map((el) => [el, el.getBoundingClientRect()]),
			);
			mutate?.();
			const last = new Map(
				elements.map((el) => [el, el.getBoundingClientRect()]),
			);

			elements.forEach((el) => {
				const f = first.get(el),
					l = last.get(el);
				const dx = f.left - l.left,
					dy = f.top - l.top;
				const sx = f.width / l.width,
					sy = f.height / l.height;
				el.style.willChange = "transform";
				el.style.transformOrigin = "top left";
				el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
			});

			requestAnimationFrame(() => {
				elements.forEach((el) => {
					el.style.transition = "transform 500ms cubic-bezier(.2,.8,.2,1)";
					el.style.transform = "none";
				});
				const cleanup = () => {
					elements.forEach((el) => {
						el.style.transition = "";
						el.style.transform = "";
						el.style.willChange = "";
					});
					onDone?.();
				};
				elements[0].addEventListener("transitionend", cleanup, { once: true });
			});
		}

		// Layout and animation States
		let isMapEnlarged = false;
		let isMapClosed = false;
		let busy = false;
		const lock = (fn) => {
			if (busy) return;
			busy = true;
			fn?.();
		};

		// Direct: Enlarged -> Closed (single FLIP; no default in between)
		function toClosedDirectFromEnlarged() {
			lock(() => {
				flipMove(
					gridEls,
					() => {
						// leave 'first' as enlarged; mutate directly to 'closed'
						guideMainLayout.classList.remove("is-enlarged"); // unstack rows
						gridEls.forEach((el) => el.classList.remove("is-enlarged")); // child columns back
						guideMainLayout.classList.add("is-closed"); // closed layout

						guideMap.classList.remove("enlarged");
						guideMap.classList.add("sticky");
					},
					() => {
						isMapEnlarged = false;
						isMapClosed = true;
						busy = false;
					},
				);
			});
		}

		// Direct: Closed -> Enlarged (single FLIP feel)
		// Phase A in FLIP = columns to enlarged; Phase B after = commit rows
		function toEnlargedDirectFromClosed() {
			lock(() => {
				flipMove(
					gridEls,
					() => {
						guideMainLayout.classList.remove("is-closed"); // back to default columns base
						gridEls.forEach((el) => el.classList.add("is-enlarged")); // animate columns to enlarged
					},
					() => {
						// commit stacked rows/UI AFTER the motion
						guideMainLayout.classList.add("is-enlarged");
						isMapClosed = false;
						isMapEnlarged = true;
						busy = false;
					},
				);
			});
		}

		// Default -> Enlarged
		function toEnlarged() {
			lock(() => {
				// Phase A: animate columns only on children (stay grid-row:1 during motion)
				flipMove(
					gridEls,
					() => {
						gridEls.forEach((el) => el.classList.add("is-enlarged")); // child .is-enlarged
					},
					() => {
						// Phase B: commit container enlarged (rows/UI)
						guideMainLayout.classList.add("is-enlarged"); // container .is-enlarged
						isMapEnlarged = true;
						busy = false;
					},
				);
			});
		}

		// Enlarged -> Default
		function toDefaultFromEnlarged() {
			lock(() => {
				// Unstack first so FLIP measures the side-by-side end state
				guideMainLayout.classList.remove("is-enlarged");
				flipMove(
					gridEls,
					() => {
						gridEls.forEach((el) => el.classList.remove("is-enlarged")); // child .is-enlarged off
					},
					() => {
						isMapEnlarged = false;
						busy = false;
					},
				);
			});
		}

		// Default -> Closed
		function toClosed() {
			lock(() => {
				// Safe: rows remain on 1; mutate container during FLIP
				flipMove(
					gridEls,
					() => {
						guideMainLayout.classList.add("is-closed"); // container .is-closed
						// Keep your map sticky UI bits consistent:
						guideMap.classList.remove("enlarged");
						guideMap.classList.add("sticky");
					},
					() => {
						isMapClosed = true;
						busy = false;
					},
				);
			});
		}

		// Closed -> Default
		function toDefaultFromClosed() {
			lock(() => {
				flipMove(
					gridEls,
					() => {
						guideMainLayout.classList.remove("is-closed");
					},
					() => {
						isMapClosed = false;
						busy = false;
					},
				);
			});
		}

		// Handle animate grid grow and shrink based on our layouts
		mapEnlargeBtn?.addEventListener("click", () => {
			if (isMapClosed) return toEnlargedDirectFromClosed();
			if (!isMapEnlarged && !isMapClosed) toEnlarged();
		});

		mapShrinkBtn?.addEventListener("click", () => {
			if (isMapEnlarged) toDefaultFromEnlarged();
		});

		mapCloseBtn?.addEventListener("click", () => {
			if (isMapEnlarged) return toClosedDirectFromEnlarged();
			if (!isMapClosed) toClosed();
		});

		mapOpenBtn?.addEventListener("click", () => {
			if (isMapClosed && !isMapEnlarged) toDefaultFromClosed();
		});

		// #### Mobile: Filters
		const mobileFilters = document.querySelector("#guideMobileFilters");
		const mobileFilterToggle = document.querySelector("#guideMobileFilterToggle");
		const mobileFilterStates = document.querySelectorAll(
			".guide_filters-mobile-wrapper .filters_toggle_icon_wrap .filters_toggle_icon",
		);
		mobileFilterText = mobileFilterToggle.querySelectorAll(
			".filters_toggle_text",
		);

		// Mobile list / map toggle
		const mapEnlargedViewWrapper = document.querySelector(
			".guide_map-enlarge-view",
		);
		const mobileListViewBtn = document.querySelector("#guideMobileList");
		const mobileMapViewBtn = document.querySelector("#guideMobileMap");
		const mobileMapViewWrapper = document.querySelector(".guide_map-wrap");
		const mobileItemsViewWrapper = document.querySelector(
			".guide_body-items-append",
		);

		// Mobile: Toggle list view
		mobileListViewBtn.addEventListener("click", () => {
			mobileListViewBtn.classList.add("is-active");
			mobileMapViewBtn.classList.remove("is-active");
			mobileItemsViewWrapper.classList.remove("u-hide");
			mapEnlargedViewWrapper.classList.add("u-hide");
			mobileMapViewWrapper.style.display = "none";
			isMapEnlarged = false;
		});

		// Mobile: Toggle map view
		mobileMapViewBtn.addEventListener("click", () => {
			mobileMapViewBtn.classList.add("is-active");
			mobileListViewBtn.classList.remove("is-active");
			mobileItemsViewWrapper.classList.add("u-hide");
			mapEnlargedViewWrapper.classList.remove("u-hide");
			mobileMapViewWrapper.style.display = "block";
			isMapEnlarged = true;
		});

		closeMobileFilters = () => {
			mobileFiltersOpen = false;
			mobileFilters.classList.remove("is-open-map", "is-open-list");
			if (mobileFilterStates.length >= 2) {
				mobileFilterStates[0].classList.remove("is2");
				mobileFilterStates[1].classList.add("is2");
			}
		};

		function openMobileFilters() {
			mobileFiltersOpen = true;
			if (isMapEnlarged) {
				mobileFilters.classList.add("is-open-map");
			} else {
				mobileFilters.classList.add("is-open-list");
			}

			if (mobileFilterStates.length >= 2) {
				mobileFilterStates[0].classList.add("is2");
				mobileFilterStates[1].classList.remove("is2");
			}
		}

		// Mobile: Close filter button
		mobileFilterToggle.addEventListener("click", () => {
			if (mobileFiltersOpen) {
				closeMobileFilters();
			} else {
				openMobileFilters();
			}
		});
	}

	// ### Handle course images from course galleries
	function initCourseGalleries() {
		const courseGalleries = document.querySelectorAll("[data-gallery='main']");

		courseGalleries.forEach((gallery) => {
			if (!gallery) return;

			const galleryMainImage = gallery.querySelector(
				"[data-gallery='main-image']",
			);
			const galleryThumbnails = gallery.querySelectorAll(
				"[data-gallery='thumbnail']",
			);

			// If there are multiple thumbnails
			if (galleryThumbnails.length > 1) {
				galleryThumbnails[0].classList.add("is-active"); // First one as active
				const thumbnailImage = galleryThumbnails[0].querySelector("img");
				galleryMainImage.src = thumbnailImage.src; // Set first image

				galleryThumbnails.forEach((thumbnail) => {
					thumbnail.addEventListener("click", () => {
						galleryThumbnails.forEach((thumb) =>
							thumb.classList.remove("is-active"),
						);
						galleryMainImage.src = thumbnail.querySelector("img").src;
						thumbnail.classList.add("is-active");
					});
				});
			}

			// If there is just one thumbnail
			if (galleryThumbnails.length === 1) {
				const thumbnailImage = galleryThumbnails[0].querySelector("img");
				galleryThumbnails[0].style.display = "none";
				galleryMainImage.src = thumbnailImage.src;
			}
		});
	}

	function boot() {
		// 1. Article content first — never gated on anything remote.
		orderAndRevealGuideItems();

		// 2. Everything else is best-effort; one failure must not hide the article.
		const steps = [initHeaderCarousel, initLayoutAndMobileControls, initCourseGalleries];
		steps.forEach((step) => {
			try {
				step();
			} catch (error) {
				console.error(`[guides] ${step.name} failed`, error);
			}
		});

		// 3. Map last; it needs Google Maps, which may be slow or blocked.
		initMap().catch((error) => {
			document.documentElement.classList.add("guides-map-failed");
			console.error("[guides] map failed to initialise", error);
		});
	}

	// The tag is loaded at the end of <body>; by the time it runs the DOM is
	// usually already parsed, so a DOMContentLoaded listener alone never fires.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
