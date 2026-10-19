/*
 * Homepage Pro Shop sections — live products from Shopify.
 *
 * Fills two Webflow components on the homepage:
 *   • Section / Pro Shop Latest       → [data-proshop="latest"]       (swiper-wrapper inside a related-section)
 *   • Section / Pro Shop Photography  → [data-proshop="photography"]  (big photo + thumbnails)
 * Each target names its Shopify collection in data-collection (e.g. "new-arrivals", "prints").
 *
 * Reads the Pro Shop's public collection JSON (no key; Shopify sends Access-Control-Allow-Origin: *).
 * Cards reuse the site's article-card classes, so Webflow styles drive the look.
 * If Shopify fails or a collection is empty, that section hides itself. A section missing from the
 * page (instance deleted in the Designer) is simply skipped.
 */
(function () {
  'use strict';

  var SHOP = 'https://proshop.thefriedegg.com';
  var UTM = 'utm_source=thefriedegg&utm_medium=homepage&utm_campaign=pro_shop_section';
  var LATEST_COUNT = 10;
  var PHOTO_COUNT = 5;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return '$' + n.toFixed(2);
  }

  function sized(src, width) {
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + width;
  }

  // Webflow image elements carry a default asset with srcset/sizes; drop those so the Shopify
  // photo actually replaces it.
  function setImage(img, src, alt) {
    if (!img) return;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = src;
    img.alt = alt;
  }

  function productUrl(handle) {
    return SHOP + '/products/' + encodeURIComponent(handle) + '?' + UTM;
  }

  // Available, photographed, non-gift-card products in the collection's own order.
  function loadCollection(handle, count) {
    var url = SHOP + '/collections/' + encodeURIComponent(handle) + '/products.json?limit=' + Math.max(count * 3, 30);
    return fetch(url, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('Shopify ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var out = [];
        (data.products || []).some(function (p) {
          if (p.product_type === 'Gift Cards' || !p.images || !p.images.length) return false;
          var available = p.variants.filter(function (v) { return v.available; });
          if (!available.length) return false;
          var prices = available.map(function (v) { return parseFloat(v.price); });
          var low = Math.min.apply(null, prices);
          var compare = Math.max.apply(null, p.variants.map(function (v) { return parseFloat(v.compare_at_price) || 0; }));
          out.push({
            title: p.title,
            handle: p.handle,
            image: p.images[0].src,
            price: low,
            varies: prices.some(function (x) { return x !== low; }),
            compare: compare > low ? compare : null,
            membersOnly: (p.tags || []).indexOf('FEGC Shop') > -1
          });
          return out.length >= count;
        });
        return out;
      });
  }

  function hideSection(el) {
    var section = el.closest('section') || el;
    section.style.display = 'none';
  }

  // ---------- Latest ----------

  function clickable(url, label) {
    return '<div class="g_clickable_wrap u-cover-absolute u-radius-inherit u-zindex-3">' +
      '<a target="_blank" rel="noopener" href="' + esc(url) + '" class="g_clickable_link u-cover-absolute u-radius-inherit u-display-block w-inline-block">' +
      '<span class="g_clickable_text u-sr-only">' + esc(label) + '</span></a></div>';
  }

  function productSlide(p) {
    var url = productUrl(p.handle);
    var tags = '';
    if (p.compare) {
      tags += '<div data-radius="tiny" class="g_article_tag_wrap u-bg-maroon u-color-primary">' +
        '<div class="g_article_tag_text u-text-style-tiny u-text-transform-uppercase u-weight-medium">Sale</div></div>';
    }
    if (p.membersOnly) {
      tags += '<div data-radius="round" class="g_article_tag_wrap">' +
        '<div class="g_article_tag_text u-text-style-tiny u-text-transform-uppercase u-weight-medium">Members only</div></div>';
    }
    var info = '<div class="g_article_info_text u-text-style-small">' + (p.varies ? 'From ' : '') + money(p.price) + '</div>';
    if (p.compare) {
      info += '<div class="g_article_info_circle"></div>' +
        '<div class="g_article_info_text u-text-style-small"><s>' + money(p.compare) + '</s></div>';
    }
    return '<div role="listitem" class="related_swiper_slide swiper-slide"><div class="g_article_wrap u-gap-gutter">' +
      '<div data-hover="visual-scale" class="g_article_visual_wrap u-visual-wrap u-radius-small">' +
        clickable(url, p.title) +
        '<img src="' + esc(sized(p.image, 640)) + '" loading="lazy" alt="' + esc(p.title) + '" class="g_article_visual u-cover-absolute">' +
      '</div>' +
      '<div class="g_article_body_wrap u-vflex-left-between u-gap-row-6"><div class="g_article_body u-vflex-left-top u-gap-row-gutter">' +
        (tags ? '<div class="g_article_tag_list u-hflex-left-center u-gap-3 u-hflex-wrap">' + tags + '</div>' : '') +
        '<div data-wf--article-heading-link--size="medium" class="g_article_heading_wrap u-text-style-h4 w-variant-4b7f610e-ca0c-31e1-ceac-9256eeef68d6">' +
          '<h3 class="g_article_heading u-line-clamp-3">' + esc(p.title) + '</h3>' + clickable(url, p.title) +
        '</div>' +
      '</div>' +
      '<div class="g_article_cta"><div class="g_article_info_wrap u-hflex-left-center u-hflex-wrap">' + info + '</div></div>' +
      '</div></div></div>';
  }

  // The site's initRelatedSwipers (in the All Articles / Events embeds) usually initialises the
  // swiper before products arrive; refresh it. If it never ran, start one with the same settings.
  function refreshSwiper(list) {
    if (!list) return;
    var section = list.closest('[data-swiper="related-section"]');
    var wrap = list.closest('.swiper');
    if (!section || !wrap) return;
    if (section.swiperInstance) {
      section.swiperInstance.update();
      return;
    }
    if (wrap.swiper) {
      wrap.swiper.update();
      return;
    }
    if (typeof window.Swiper !== 'function') return;
    section.swiperInstance = new window.Swiper(wrap, {
      slidesPerView: 'auto',
      spaceBetween: 20,
      grabCursor: true,
      speed: 600,
      slideActiveClass: 'is-active',
      mousewheel: { forceToAxis: true },
      keyboard: { enabled: true, onlyInViewport: true },
      navigation: {
        nextEl: section.querySelector('[data-swiper-arrow^="related-next"]'),
        prevEl: section.querySelector('[data-swiper-arrow^="related-prev"]')
      },
      breakpoints: {
        0: { slidesPerView: 1, spaceBetween: 16 },
        480: { slidesPerView: 'auto', spaceBetween: 20 }
      }
    });
  }

  function initLatest(list) {
    loadCollection(list.getAttribute('data-collection') || 'new-arrivals', LATEST_COUNT)
      .then(function (products) {
        if (!products.length) return hideSection(list);
        list.innerHTML = products.map(productSlide).join('');
        refreshSwiper(list);
      })
      .catch(function () { hideSection(list); });
  }

  // ---------- Photography ----------

  function initPhotography(root) {
    var main = root.querySelector('.proshop_photo_img');
    var expand = root.querySelector('.proshop_photo_expand');
    var card = root.querySelector('.proshop_photo_card');
    var thumb = root.querySelector('.proshop_photo_thumb');
    var title = root.querySelector('.proshop_photo_title');
    var price = root.querySelector('.proshop_photo_price');
    var dots = root.querySelector('.proshop_photo_thumbs');
    var template = dots && dots.querySelector('.proshop_photo_dot');
    if (!main || !card || !dots || !template) return;
    main.removeAttribute('loading');

    loadCollection(root.getAttribute('data-collection') || 'prints', PHOTO_COUNT)
      .then(function (prints) {
        if (!prints.length) return hideSection(root);
        [expand, card].forEach(function (a) {
          if (!a) return;
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        });
        if (expand) expand.setAttribute('aria-label', 'Open this print in the Pro Shop');

        dots.innerHTML = '';
        var buttons = prints.map(function (p, i) {
          var dot = template.cloneNode(true);
          dot.setAttribute('role', 'button');
          dot.setAttribute('tabindex', '0');
          dot.setAttribute('aria-label', 'Show ' + p.title);
          setImage(dot.querySelector('img'), sized(p.image, 160), '');
          dot.addEventListener('click', function () { show(i); });
          dot.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              show(i);
            }
          });
          dots.appendChild(dot);
          return dot;
        });

        function show(i) {
          var p = prints[i];
          setImage(main, sized(p.image, 1600), p.title);
          setImage(thumb, sized(p.image, 240), '');
          if (title) title.textContent = p.title;
          if (price) price.textContent = (p.varies ? 'From ' : '') + money(p.price);
          card.href = productUrl(p.handle);
          if (expand) expand.href = productUrl(p.handle);
          buttons.forEach(function (b, j) {
            b.style.borderColor = j === i ? 'var(--_colours---base--white)' : 'transparent';
            b.setAttribute('aria-pressed', j === i ? 'true' : 'false');
          });
        }

        show(0);
        // Warm the cache so switching prints is instant.
        prints.slice(1).forEach(function (p) {
          var pre = new Image();
          pre.src = sized(p.image, 1600);
        });
      })
      .catch(function () { hideSection(root); });
  }

  // Targets are found by data attribute when present, otherwise by the classes the Webflow
  // components publish (headless attribute writes on these elements did not persist).
  function targets(attrSelector, fallbackSelector) {
    var found = document.querySelectorAll(attrSelector);
    return found.length ? found : document.querySelectorAll(fallbackSelector);
  }

  function boot() {
    targets('[data-proshop="latest"]', '[data-proshop-section="latest"] .related_swiper_list').forEach(initLatest);
    targets('[data-proshop="photography"]', '[data-proshop-section="photography"] .proshop_photo').forEach(initPhotography);
    // The static category rail has no data-swiper="related" tag, so the site's init skips it.
    document.querySelectorAll('.proshop_cat_card').forEach(function (card, i) {
      if (i === 0) refreshSwiper(card.closest('.related_swiper_list'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
