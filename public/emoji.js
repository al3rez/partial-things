/* Same lookup as react-apple-emojis: name -> Apple image on the library CDN. */
const AppleEmojis = {
    data: null,
    async load() {
        const res = await fetch("emoji-data.json");
        if (!res.ok) throw new Error("Could not load Apple emojis");
        this.data = await res.json();
    },
    key(name) {
        return String(name || "").trim().toLowerCase().replaceAll(" ", "-");
    },
    url(name) {
        if (!this.data) return "";
        const suffix = this.data.emojis[this.key(name)];
        return suffix ? this.data.baseUrl + suffix : "";
    },
    img(name, size = 18) {
        const src = this.url(name);
        if (!src) return "";
        const safe = String(src).replace(/"/g, "%22");
        return `<img class="emoji" src="${safe}" alt="" width="${size}" height="${size}" draggable="false">`;
    },
    search(query, limit = 64) {
        if (!this.data) return [];
        const suggested = ["star", "glowing-star", "package", "inbox-tray", "calendar", "spiral-calendar", "books", "green-book", "open-book", "file-folder", "card-file-box", "wastebasket", "beach-with-umbrella", "office-building", "birthday-cake", "house", "house-with-garden", "briefcase", "alarm-clock", "bell", "repeat-button", "pushpin", "round-pushpin", "label", "airplane", "automobile", "shopping-cart", "fork-and-knife", "teacup-without-handle", "wrapped-gift", "party-popper", "red-heart", "check-mark", "light-bulb", "memo", "clipboard", "hammer-and-wrench", "soccer-ball", "musical-note"];
        const q = this.key(query);
        const keys = Object.keys(this.data.emojis);
        const hits = q ? keys.filter((name) => name.includes(q)) : suggested.filter((name) => this.data.emojis[name]);
        return hits.slice(0, limit);
    }
};
