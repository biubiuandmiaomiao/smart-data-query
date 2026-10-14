import { modelSettings } from './store.js';
export async function callModel(messages) {
  const settings = modelSettings();
  if (!settings.apiKey) throw new Error('模型尚未配置，请到「连接与模型」保存 API Key');
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, temperature: 0, response_format: { type: 'json_object' }, messages }), signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}），请检查密钥、模型名称和余额`);
  const payload = await response.json();
  try { return JSON.parse(payload.choices?.[0]?.message?.content); }
  catch { throw new Error('模型未返回有效 JSON，请重新分析'); }
}
