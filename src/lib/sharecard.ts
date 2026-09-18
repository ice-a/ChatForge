/**
 * 分享卡片：用离屏 canvas 把用户画像 + 用量统计画成 1080×1440 PNG。
 * 社交传播点：用户晒「我的 AI 使用报告」。
 */
import { fsMkdir, fsWriteFile, pathJoin } from '../bridge/client';
import { getToolSummary, initDb, type ToolSummary } from './db';
import type { UserProfile } from '../types';

export interface ShareCardData {
  profile: UserProfile;
  tools: ToolSummary[];
  totalSessions: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export async function collectShareData(homeDir: string, profile: UserProfile): Promise<ShareCardData> {
  const db = await initDb(homeDir);
  const tools = await getToolSummary(db);
  return {
    profile,
    tools,
    totalSessions: tools.reduce((a, t) => a + t.sessions, 0),
    totalTokensIn: tools.reduce((a, t) => a + Number(t.tokens_in ?? 0), 0),
    totalTokensOut: tools.reduce((a, t) => a + Number(t.tokens_out ?? 0), 0),
  };
}

const W = 1080;
const H = 1440;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): number {
  let line = '';
  let yy = y;
  let lines = 0;
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) {
      ctx.fillText(line, x, yy);
      yy += lineH;
      lines++;
      line = ch;
      if (lines >= maxLines - 1) break;
    } else {
      line += ch;
    }
  }
  ctx.fillText(line + (lines >= maxLines - 1 ? '…' : ''), x, yy);
  return yy + lineH;
}

export function renderShareCard(data: ShareCardData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 背景：深靛渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1e1b4b');
  grad.addColorStop(0.55, '#312e81');
  grad.addColorStop(1, '#4c1d95');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 顶部标题
  ctx.fillStyle = '#a5b4fc';
  ctx.font = '600 30px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('CHATFORGE · AI 使用报告', 80, 110);

  // 称呼 + 类型
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 68px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(data.profile.nickname.slice(0, 14), 80, 200);
  ctx.fillStyle = '#c4b5fd';
  ctx.font = '34px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(data.profile.archetype.slice(0, 20), 82, 252);

  // 三个大数字
  const stats: [string, string][] = [
    ['会话', String(data.totalSessions)],
    ['输入 Token', data.totalTokensIn >= 1e6 ? (data.totalTokensIn / 1e6).toFixed(1) + 'M' : String(data.totalTokensIn)],
    ['输出 Token', data.totalTokensOut >= 1e6 ? (data.totalTokensOut / 1e6).toFixed(1) + 'M' : String(data.totalTokensOut)],
  ];
  stats.forEach(([label, value], i) => {
    const x = 80 + i * 320;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, x, 300, 290, 150, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(value.slice(0, 10), x + 24, 372);
    ctx.fillStyle = '#a5b4fc';
    ctx.font = '24px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(label, x + 24, 418);
  });

  // 能力雷达（手工画六边形雷达）
  const dims = data.profile.dimensions.slice(0, 6);
  const cx = 300, cy = 700, R = 180;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, r: number): [number, number] => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  for (const ring of [1, 0.66, 0.33]) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R * ring);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R);
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 数据多边形
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const score = dims[i]?.score ?? 0;
    const [x, y] = pt(i, (R * score) / 5);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(129,140,248,0.45)';
  ctx.fill();
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 维度标签
  ctx.fillStyle = '#c7d2fe';
  ctx.font = '22px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R + 34);
    ctx.fillText((dims[i]?.name ?? '').slice(0, 8), x, y + 6);
  }
  ctx.textAlign = 'left';

  // 技术栈标签云（右侧）
  ctx.font = '600 28px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = '#e0e7ff';
  ctx.fillText('技术栈', 620, 560);
  const tags = [
    ...data.profile.techStack.languages.slice(0, 4),
    ...data.profile.techStack.frameworks.slice(0, 5),
    ...data.profile.techStack.aiTools.slice(0, 3),
  ].slice(0, 10);
  let tx = 620, ty = 610;
  ctx.font = '26px system-ui, "Segoe UI", sans-serif';
  for (const tag of tags) {
    const tw = ctx.measureText(tag).width + 28;
    if (tx + tw > W - 80) {
      tx = 620;
      ty += 58;
      if (ty > 900) break;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, tx, ty - 30, tw, 42, 21);
    ctx.fill();
    ctx.fillStyle = '#e0e7ff';
    ctx.fillText(tag, tx + 14, ty);
    tx += tw + 12;
  }

  // 智能体记忆精选
  ctx.fillStyle = '#e0e7ff';
  ctx.font = '600 28px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('AI 记住了', 80, 980);
  ctx.font = '24px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  let yy = 1022;
  for (const m of data.profile.memory.slice(0, 4)) {
    yy = drawWrapped(ctx, '· ' + m, 80, yy, W - 160, 34, 2) + 6;
    if (yy > 1230) break;
  }

  // 工具列表（底部一行）
  if (data.tools.length) {
    ctx.fillStyle = '#a5b4fc';
    ctx.font = '22px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('数据来源：' + data.tools.map((t) => t.tool).join(' / ').slice(0, 70), 80, 1340);
  }

  // 底部水印
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '22px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Generated by ChatForge · 会话锻造厂', 80, 1400);

  return canvas;
}

/** 生成并导出分享卡片 PNG，返回文件路径 */
export async function exportShareCard(homeDir: string, data: ShareCardData): Promise<string> {
  const canvas = renderShareCard(data);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob 失败');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const dir = await pathJoin(homeDir, 'Downloads', 'chatforge', 'share');
  await fsMkdir(dir);
  const file = await pathJoin(dir, `chatforge-share-${Date.now().toString(36)}.png`);
  // data URL 交给前端下载 + 同时写文件系统
  const dataUrl = `data:image/png;base64,${b64}`;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = file.split(/[\\/]/).pop() || 'chatforge-share.png';
  a.click();
  return file;
}
