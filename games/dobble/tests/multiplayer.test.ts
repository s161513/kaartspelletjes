import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { RoomManager } from "../../../server/src/rooms.js";
import { attachConnection } from "../../../server/src/handlers.js";
import { loadGames } from "../../../server/src/games/loader.js";
import type { DobbleView, DobbleMove } from "../types.js";

type Message={type:string;[key:string]:any};
async function until<T>(read:()=>T|undefined,timeout=5000):Promise<T> {
  const end=Date.now()+timeout;
  while(Date.now()<end){const result=read();if(result!==undefined)return result;await sleep(5);}
  throw Error("Timed out waiting for WebSocket state");
}
class Client {
  messages:Message[]=[];
  constructor(readonly ws:WebSocket){ws.on("message",raw=>this.messages.push(JSON.parse(raw.toString())));}
  send(msg:Message){this.ws.send(JSON.stringify(msg));}
  async request(msg:Message,type:string){const index=this.messages.length;this.send(msg);return until(()=>this.messages.slice(index).find(m=>m.type===type));}
  view():DobbleView|undefined{return this.messages.findLast(m=>["gameStarted","gameState","gameOver"].includes(m.type))?.state;}
  move():DobbleMove {const s=this.view()!;return {type:"symbolClick",roundId:s.round.id,symbolId:s.round.own.find(id=>s.round.center.includes(id))!};}
}
async function fixture(t:import("node:test").TestContext){
  await loadGames();const manager=new RoomManager();const server=createServer();const wss=new WebSocketServer({server,path:"/ws"});
  wss.on("connection",ws=>attachConnection(ws,manager));await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const address=server.address();const port=typeof address==="object"&&address ? address.port : 0;const clients:Client[]=[];
  t.after(async()=>{for(const c of clients)c.ws.terminate();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));manager.dispose();});
  async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);const c=new Client(ws);clients.push(c);await new Promise<void>((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});return c;}
  return {connect,manager};
}
test("real sockets: eight players, race, stale click, score, game over and rematch",{timeout:25000},async t=>{
  const {connect}=await fixture(t);const host=await connect();const joined=await host.request({type:"create",nickname:"Nathan"},"joined");
  assert.equal((await host.request({type:"startGame",gameId:"dobble"},"error")).code,"too_few");
  const players=[host];for(let i=1;i<8;i++){const c=await connect();await c.request({type:"join",nickname:`Speler ${i}`,roomCode:joined.roomCode},"joined");players.push(c);}
  assert.equal((await players[1].request({type:"startGame",gameId:"dobble"},"error")).code,"not_host");
  const ninth=await connect();await ninth.request({type:"join",nickname:"Negende",roomCode:joined.roomCode},"joined");
  assert.equal((await host.request({type:"startGame",gameId:"dobble"},"error")).code,"too_many");ninth.send({type:"leave"});
  await sleep(30);await host.request({type:"startGame",gameId:"dobble"},"gameStarted");await until(()=>players.every(p=>p.view())?true:undefined);
  const views=players.map(p=>p.view()!);assert.equal(new Set(views.map(v=>[...v.round.own].sort((a,b)=>a-b).join(","))).size,8);
  for(const v of views){assert.deepEqual(v.round.center,views[0].round.center);assert.equal(v.round.own.filter(s=>v.round.center.includes(s)).length,1);assert.ok(!JSON.stringify(v).includes("hands"));}
  const starts=players.map(p=>p.messages.length);const moves=players.map(p=>p.move());players.forEach((p,i)=>p.send({type:"move",move:moves[i]}));
  await until(()=>players.every((p,i)=>p.messages.slice(starts[i]).some(m=>m.type==="gameState"&&m.state.round.status==="completed"))?true:undefined);
  assert.equal(players.reduce((n,p,i)=>n+p.messages.slice(starts[i]).filter(m=>m.type==="error").length,0),7);
  assert.equal(Object.values(host.view()!.scores).reduce((n,s)=>n+s,0),1);
  const winnerId=host.view()!.round.winnerId!;const winner=players.find(p=>p.messages.find(m=>m.type==="joined")!.playerId===winnerId)!;
  await until(()=>winner.view()?.round.number===2?true:undefined);
  assert.equal((await winner.request({type:"move",move:moves[players.indexOf(winner)]},"error")).code,"bad_move");
  for(let score=2;score<=10;score++) {
    const round=winner.view()!.round.number;await winner.request({type:"move",move:winner.move()},score===10?"gameOver":"gameState");
    if(score<10)await until(()=>winner.view()?.round.number===round+1?true:undefined);
  }
  await until(()=>players.every(p=>p.messages.some(m=>m.type==="gameOver"))?true:undefined);
  for(const p of players){const over=p.messages.findLast(m=>m.type==="gameOver")!;assert.equal(over.winner,winnerId);assert.equal(over.state.scores[winnerId],10);assert.ok(!JSON.stringify(over).includes("hands"));}
  await host.request({type:"startGame",gameId:"dobble"},"gameStarted");assert.equal(host.view()!.round.number,1);assert.ok(Object.values(host.view()!.scores).every(s=>s===0));
});
test("real sockets: wrong click, reconnect restores hand/score, host migration and leave",{timeout:10000},async t=>{
  const {connect,manager}=await fixture(t);const a=await connect();const joined=await a.request({type:"create",nickname:"A"},"joined");
  const b=await connect();await b.request({type:"join",nickname:"B",roomCode:joined.roomCode},"joined");await a.request({type:"startGame",gameId:"dobble"},"gameStarted");
  const first=a.view()!;const wrong=first.round.own.find(s=>!first.round.center.includes(s))!;
  assert.equal((await a.request({type:"move",move:{...a.move(),symbolId:wrong}},"error")).code,"bad_move");assert.equal(a.view()!.scores[joined.playerId],0);
  await sleep(420);await a.request({type:"move",move:a.move()},"gameState");assert.equal(a.view()!.scores[joined.playerId],1);
  await until(()=>a.view()?.round.number===2?true:undefined);const saved=a.view()!;a.ws.close();
  await until(()=>manager.getRoom(joined.roomCode)?.players.get(joined.playerId)?.connected===false?true:undefined);
  assert.equal(manager.getRoom(joined.roomCode)!.hostId,b.messages.find(m=>m.type==="joined")!.playerId);
  assert.equal(b.view()!.paused,true);
  const again=await connect();await again.request({type:"rejoin",playerId:joined.playerId,roomCode:joined.roomCode,secret:joined.secret},"gameStarted");
  assert.deepEqual(again.view()!.round,saved.round);assert.equal(again.view()!.scores[joined.playerId],1);assert.equal(again.view()!.paused,false);
  b.send({type:"leave"});await until(()=>again.view()?.paused===true?true:undefined);
  assert.equal(manager.getRoom(joined.roomCode)!.players.size,1);
});
test("real sockets: reconnect replacement's old close cannot disconnect the new seat",async t=>{
  const {connect,manager}=await fixture(t);const a=await connect();const joined=await a.request({type:"create",nickname:"A"},"joined");
  const b=await connect();await b.request({type:"join",nickname:"B",roomCode:joined.roomCode},"joined");await a.request({type:"startGame",gameId:"dobble"},"gameStarted");
  const replacement=await connect();await replacement.request({type:"rejoin",roomCode:joined.roomCode,playerId:joined.playerId,secret:joined.secret},"gameStarted");a.ws.close();await sleep(30);
  assert.equal(manager.getRoom(joined.roomCode)!.players.get(joined.playerId)!.connected,true);assert.equal(replacement.view()!.paused,false);
});
test("real sockets: existing Tic-Tac-Toe start, invalid turn, win and rematch",async t=>{
  const {connect}=await fixture(t);const a=await connect();const joined=await a.request({type:"create",nickname:"A"},"joined");const b=await connect();await b.request({type:"join",nickname:"B",roomCode:joined.roomCode},"joined");
  await a.request({type:"startGame",gameId:"tictactoe"},"gameStarted");assert.equal((await b.request({type:"move",move:{cell:0}},"error")).code,"bad_move");
  for(const [c,cell] of [[a,0],[b,3],[a,1],[b,4],[a,2]] as const)await c.request({type:"move",move:{cell}},cell===2?"gameOver":"gameState");
  assert.equal(a.messages.findLast(m=>m.type==="gameOver")!.winner,joined.playerId);await a.request({type:"startGame",gameId:"tictactoe"},"gameStarted");assert.deepEqual((a.messages.findLast(m=>m.type==="gameStarted")!.state as {board:unknown[]}).board,Array(9).fill(null));
});
