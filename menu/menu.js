// Reads one venue's live menu from the Uğra server and shows it; prices and deals are those of this moment.
// The venue comes in the address: menu/?s=gold-karaca (and &masa=Bahçe 3 from a table QR)
(function () {
    "use strict";

    var settings = window.UGRA || {};
    var cloud = (settings.api || "").replace(/\/+$/, "");
    var slug = new URLSearchParams(location.search).get("s") || "";
    var money = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var dayNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

    var state = { menu: null, category: "", search: "" };
    var $ = function (id) { return document.getElementById(id); };

    function text(value) {
        var div = document.createElement("div");
        div.textContent = value == null ? "" : String(value);
        return div.innerHTML;
    }

    function price(value) { return money.format(value) + " ₺"; }

    function foldTr(value) {
        return (value || "").toLocaleLowerCase("tr-TR")
            .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
            .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
    }

    function dealDays(days) {
        if (days === "1234567") return "Her gün";
        if (days === "12345") return "Hafta içi";
        if (days === "67") return "Hafta sonu";
        return days.split("").map(function (d) { return dayNames[Number(d) - 1] || ""; }).join(", ");
    }

    function hhmm(value) { return (value || "").slice(0, 5); }

    // Table name from the table QR: "Bahçe 3 masasındasın"
    function showTable() {
        var table = new URLSearchParams(location.search).get("masa");
        if (!table) return;

        $("table-hint").innerHTML =
            "<strong>" + text(table) + "</strong> masasındasın. Siparişini garsona söyleyebilir ya da " +
            "Uğra uygulamasından verebilirsin.";
        $("table-hint").hidden = false;
    }

    function showStore() {
        if (settings.storeUrl) $("store-link").href = settings.storeUrl;
    }

    // The venue's name for the heading
    function showVenue() {
        fetch(cloud + "/c/api/venues", { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (venues) {
                var venue = venues.filter(function (v) { return v.slug === slug; })[0];
                if (!venue) return;
                $("title").textContent = venue.name;
                $("venue-name").textContent = venue.city || "";
                document.title = "Menü · " + venue.name;
            })
            .catch(function () { });
    }

    function renderNotices(menu) {
        var html = "";

        (menu.announcements || []).forEach(function (a) {
            html += '<div class="notice"><strong>' + text(a.title) + "</strong><div>" + text(a.message) + "</div></div>";
        });

        // Bill campaigns: "5.000 ₺ ve üzeri hesaba %10 indirim", "3 al 2 öde"
        (menu.campaigns || []).forEach(function (c) {
            html += '<div class="deal' + (c.activeNow ? " is-active" : "") + '">' +
                '<span class="deal-percent">★</span>' +
                "<div><strong>" + text(c.name) + '</strong><div class="muted">' + text(c.description) +
                (c.activeNow ? " · <b>Şu an geçerli</b>" : "") + "</div></div></div>";
        });

        (menu.deals || []).forEach(function (d) {
            var where = d.productName ? text(d.productName) : d.category ? text(d.category) : "Tüm menü";
            var badge = d.discountAmount > 0
                ? "-" + Number(d.discountAmount).toLocaleString("tr-TR") + " ₺"
                : "%" + Number(d.discountPercent).toLocaleString("tr-TR");
            html += '<div class="deal' + (d.activeNow ? " is-active" : "") + '">' +
                '<span class="deal-percent">' + badge + "</span>" +
                "<div><strong>" + text(d.name) + "</strong><div class=\"muted\">" + where + " · " +
                dealDays(d.days) + " " + hhmm(d.startTime) + "-" + hhmm(d.endTime) +
                (d.activeNow ? " · <b>Şu an geçerli</b>" : "") + "</div></div></div>";
        });

        $("notices").innerHTML = html;
    }

    function renderChips(menu) {
        var categories = [];
        menu.items.forEach(function (i) { if (categories.indexOf(i.category) < 0) categories.push(i.category); });

        var html = '<button class="chip' + (state.category === "" ? " is-on" : "") + '" data-category="">Tümü</button>';
        categories.forEach(function (c) {
            html += '<button class="chip' + (state.category === c ? " is-on" : "") + '" data-category="' + text(c) + '">' + text(c) + "</button>";
        });
        $("chips").innerHTML = html;
    }

    function renderItems(menu) {
        var search = foldTr(state.search.trim());
        var items = menu.items.filter(function (i) {
            return (!state.category || i.category === state.category)
                && (!search || foldTr(i.name).indexOf(search) >= 0 || foldTr(i.category).indexOf(search) >= 0);
        });

        if (items.length === 0) {
            $("items").innerHTML = '<p class="muted center">Aradığın ürün bulunamadı.</p>';
            return;
        }

        var html = "";
        var current = null;

        items.forEach(function (i) {
            if (i.category !== current) {
                if (current !== null) html += "</div>";
                current = i.category;
                html += '<h2 class="category">' + text(current) + '</h2><div class="list">';
            }

            var priceHtml = i.salePrice != null
                ? '<s>' + price(i.price) + '</s><span class="sale">' + price(i.salePrice) + "</span>"
                : price(i.price);

            var extras = [];
            if (i.saleName) extras.push('<span class="tag is-sale">' + text(i.saleName) + "</span>");
            if (i.xp > 0) extras.push('<span class="tag">★ ' + i.xp + " XP</span>");
            if (i.allergens) extras.push('<span class="allergens">İçerir: ' + text(i.allergens) + "</span>");

            html += '<div class="item' + (i.inStock ? "" : " is-out") + '">' +
                '<div class="item-text"><div class="item-name">' + text(i.name) +
                (i.inStock ? "" : ' <span class="tag is-out">Tükendi</span>') + "</div>" +
                (extras.length ? '<div class="item-extras">' + extras.join(" ") + "</div>" : "") +
                '</div><div class="item-price">' + priceHtml + "</div></div>";
        });

        $("items").innerHTML = html + "</div>";
    }

    function render() {
        if (!state.menu) return;
        renderChips(state.menu);
        renderItems(state.menu);
    }

    function fail(message) {
        $("status").innerHTML = '<p class="muted center">' + message + '</p><p class="center"><button class="button" id="retry">Tekrar dene</button></p>';
        $("status").hidden = false;
        $("retry").onclick = load;
    }

    function load() {
        $("status").innerHTML = '<p class="muted center">Menü yükleniyor...</p>';
        $("status").hidden = false;

        if (!cloud || !slug) {
            fail(slug ? "Menü adresi ayarlanmamış." : "Hangi mekanın menüsü olduğu bağlantıda yok.");
            return;
        }

        fetch(cloud + "/c/" + encodeURIComponent(slug) + "/api/menu", { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) throw new Error(response.status);
                return response.json();
            })
            .then(function (menu) {
                if (!menu.items || menu.items.length === 0) {
                    fail("Menü şu an hazır değil. Biraz sonra tekrar bak.");
                    return;
                }

                state.menu = menu;
                $("status").hidden = true;
                $("menu").hidden = false;
                renderNotices(menu);
                render();
            })
            .catch(function () {
                fail("Menüye şu an ulaşılamıyor. İnternet bağlantını kontrol edip tekrar dene.");
            });
    }

    $("chips").addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        state.category = chip.getAttribute("data-category");
        render();
    });

    $("search").addEventListener("input", function (e) {
        state.search = e.target.value;
        if (state.search) state.category = "";
        render();
    });

    showTable();
    showStore();
    showVenue();
    load();
})();
