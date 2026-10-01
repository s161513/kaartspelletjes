import { test, expect, type Page } from "@playwright/test";
async function symbol(page: Page, correct=true) {
  const center=await page.getByRole("group",{name:"Centrale kaart",exact:true}).locator("[data-symbol-id]").evaluateAll(ns=>ns.map(n=>Number(n.getAttribute("data-symbol-id"))));
  const own=await page.getByRole("group",{name:"Jouw kaart",exact:true}).locator("button").evaluateAll(ns=>ns.map(n=>Number(n.getAttribute("data-symbol-id"))));
  return own.find(s=>center.includes(s)===correct)!;
}
async function lobbyHost(pages: Page[]) {
  for(const p of pages)if(await p.getByRole("button",{name:"Start Dobble",exact:true}).isEnabled())return p;
  throw Error("No host in lobby");
}
test("eight browser sessions: common lobby, chat, Dobble, reconnect, victory, rematch and game switching",async({browser})=>{
  const errors:string[]=[];
  const contexts=await Promise.all(Array.from({length:8},(_,i)=>browser.newContext({viewport:i===0?{width:1280,height:900}:{width:390,height:844}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  pages.forEach(p=>{p.on("pageerror",e=>errors.push(e.message));p.on("console",m=>{if(m.type()==="error")errors.push(m.text());});});
  try {
    const a=pages[0];await a.goto("/");await a.getByLabel("Your nickname").fill("Nathan");await a.getByRole("button",{name:"Create a room"}).click();await expect(a).toHaveURL(/lobby.html/);
    const code=(await a.locator("#roomCode").innerText()).trim();
    for(let i=1;i<8;i++){
      await pages[i].goto("/");await pages[i].getByLabel("Your nickname").fill(`Vriend ${i}`);await pages[i].getByLabel("Join an existing room").fill(code);await pages[i].getByRole("button",{name:"Join room"}).click();await expect(pages[i]).toHaveURL(/lobby.html/);
    }
    await expect(a.locator("#players li")).toHaveCount(8);await expect(a.getByRole("button",{name:"Start Tic-tac-toe",exact:true})).toBeDisabled();
    await a.locator("#chatInput").fill("Dobble tijd!");await a.getByRole("button",{name:"Send",exact:true}).click();await expect(pages[7].locator("#chatLog")).toContainText("Dobble tijd!");
    const host=await lobbyHost(pages);await host.getByRole("button",{name:"Start Dobble",exact:true}).click();
    for(const p of pages){await expect(p).toHaveURL(/game.html\?game=dobble/);await expect(p.getByRole("group",{name:"Jouw kaart",exact:true}).locator("button")).toHaveCount(8);await expect(p.locator(".score-chip")).toHaveCount(8);}
    const hands=await Promise.all(pages.map(p=>p.getByRole("group",{name:"Jouw kaart",exact:true}).locator("button").evaluateAll(ns=>ns.map(n=>n.getAttribute("data-symbol-id")).sort().join(","))));expect(new Set(hands).size).toBe(8);
    await pages[1].screenshot({path:"games/dobble/test-results/game-mobile.png",fullPage:true});await a.screenshot({path:"games/dobble/test-results/game-desktop.png",fullPage:true});
    for(const p of pages){
      expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const card=p.getByRole("group",{name:"Jouw kaart",exact:true});const bounds=await card.boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(p.viewportSize()!.height);
      for(const button of await card.locator("button").all()){const box=await button.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);}
    }
    await a.locator(`button[data-symbol-id="${await symbol(a,false)}"]`).click();await expect(a.locator(".dobble-board")).toHaveClass(/wrong/);await expect(a.locator(".dobble-board")).not.toHaveClass(/wrong/);
    const id=await a.evaluate(()=>sessionStorage.getItem("cg.playerId"));
    for(let score=1;score<=10;score++) {
      await a.locator(`button[data-symbol-id="${await symbol(a)}"]`).click();
      if(score<10)await expect(a.locator(".round-count")).toContainText(`Ronde ${score+1}`);
      if(score===1){
        const hand=await a.getByRole("group",{name:"Jouw kaart",exact:true}).locator("button").evaluateAll(ns=>ns.map(n=>n.getAttribute("data-symbol-id")));
        await a.reload();await expect(a.locator(".my-score strong")).toHaveText("1");expect(await a.evaluate(()=>sessionStorage.getItem("cg.playerId"))).toBe(id);
        expect(await a.getByRole("group",{name:"Jouw kaart",exact:true}).locator("button").evaluateAll(ns=>ns.map(n=>n.getAttribute("data-symbol-id")))).toEqual(hand);
        await contexts[0].setOffline(true);await expect(a.locator(".dobble-network")).toBeVisible();await contexts[0].setOffline(false);await expect(a.locator(".dobble-network")).toBeHidden();await expect(a.locator(".my-score strong")).toHaveText("1");
      }
    }
    for(const p of pages){await expect(p.getByRole("heading",{name:"Nathan wint!"})).toBeVisible();await expect(p.getByRole("button",{name:"Back to lobby"})).toBeVisible();}
    await pages[1].screenshot({path:"games/dobble/test-results/results-mobile.png",fullPage:true});
    for(const p of pages){await p.getByRole("button",{name:"Back to lobby"}).click();await expect(p).toHaveURL(/lobby.html/);}
    const restart=await lobbyHost(pages);await restart.getByRole("button",{name:"Start Dobble",exact:true}).click();await expect(a.locator(".round-count")).toContainText("Ronde 1");await expect(a.locator(".score-chip strong")).toHaveText(Array(8).fill("0"));
    // Complete the rematch, then switch the same room from Dobble to Tic-Tac-Toe.
    for(let score=1;score<=10;score++){await a.locator(`button[data-symbol-id="${await symbol(a)}"]`).click();if(score<10)await expect(a.locator(".round-count")).toContainText(`Ronde ${score+1}`);}
    for(const p of pages){await expect(p.getByRole("heading",{name:"Nathan wint!"})).toBeVisible();await p.getByRole("button",{name:"Back to lobby"}).click();await expect(p).toHaveURL(/lobby.html/);}
    for(let i=2;i<8;i++){await pages[i].getByRole("button",{name:"Leave room"}).click();await expect(pages[i]).toHaveURL("http://127.0.0.1:4317/");}
    const leader=await lobbyHost(pages.slice(0,2));await expect(leader.locator("#players li")).toHaveCount(2);await leader.getByRole("button",{name:"Start Tic-tac-toe",exact:true}).click();
    for(const p of pages.slice(0,2)){await expect(p).toHaveURL(/game=tictactoe/);await expect(p.locator(".cell")).toHaveCount(9);}
    for(const cell of [0,3,1,4,2]){
      let mover:Page|undefined;for(const p of pages.slice(0,2))if(await p.locator(`[data-cell="${cell}"]`).isEnabled())mover=p;
      if(!mover){await expect(pages[0].locator("#status")).toContainText(/turn|win|lose/i);await new Promise(r=>setTimeout(r,100));for(const p of pages.slice(0,2))if(await p.locator(`[data-cell="${cell}"]`).isEnabled())mover=p;}
      expect(mover).toBeDefined();await mover!.locator(`[data-cell="${cell}"]`).click();for(const p of pages.slice(0,2))await expect(p.locator(`[data-cell="${cell}"]`)).not.toHaveText("");
    }
    for(const p of pages.slice(0,2))await expect(p.getByRole("button",{name:"Back to lobby"})).toBeVisible();
    expect(errors).toEqual([]);
  } finally {await Promise.all(contexts.map(c=>c.close()));}
});
