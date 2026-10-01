import { setupGamePage } from "./gameHost.js";
import { getMeta, loadView } from "./catalog.js";

// One page for every game: /game.html?game=<id>.
const id = new URLSearchParams(location.search).get("game") ?? "";
const meta = getMeta(id);
const view = loadView(id);

if (!meta || !view) {
  location.href = "/lobby.html";
} else {
  view.then((m) => setupGamePage(m.default, meta));
}
