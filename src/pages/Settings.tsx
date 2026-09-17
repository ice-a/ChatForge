import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Slider,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { sqliteQuery } from '../bridge/client';
import { useAppStore } from '../store';
import { getCustomSources, getLastScanReport, getSourceStatuses, runScan, saveCustomSources, type SourceStatus } from '../lib/scan';
import { saveLlmConfig, loadLlmConfig } from '../lib/profile';
import { testLLM, LLM_PRESETS } from '../lib/llm';
import { clearAllData, getHubPath, initDb, saveSetting } from '../lib/db';
import { exportText } from '../lib/export';
import type { CustomSource, LlmConfig } from '../types';
import dayjs from 'dayjs';

export default function Settings() {
  const { message, modal } = AntApp.useApp();
  const { homeDir, bumpDataVersion } = useAppStore();
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [customSources, setCustomSources] = useState<CustomSource[]>([]);
  const [lastScan, setLastScan] = useState<{ at: number; report: Awaited<ReturnType<typeof getLastScanReport>>['report'] }>({ at: 0, report: [] });
  const [hubPath, setHubPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newSource, setNewSource] = useState<CustomSource>({ id: '', name: '', path: '', format: 'chat-jsonl' });
  const [llmForm] = Form.useForm<LlmConfig>();

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      const db = await initDb(homeDir);
      setSources(await getSourceStatuses(homeDir));
      setCustomSources(await getCustomSources(homeDir));
      setLastScan(await getLastScanReport(homeDir));
      setHubPath(await getHubPath(homeDir));
      const cfg = await loadLlmConfig(homeDir);
      if (cfg) llmForm.setFieldsValue(cfg);
      else llmForm.setFieldsValue({ protocol: 'openai', baseUrl: '', apiKey: '', model: '', temperature: 0.4 });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [homeDir, message, llmForm]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateSource = async (toolId: string, patch: { enabled?: boolean; customPaths?: string }) => {
    const db = await initDb(homeDir);
    if (patch.enabled !== undefined) await saveSetting(db, `source.${toolId}.enabled`, patch.enabled ? '1' : '0');
    if (patch.customPaths !== undefined) await saveSetting(db, `source.${toolId}.paths`, patch.customPaths);
    setSources(await getSourceStatuses(homeDir));
  };

  const scanOne = async (toolId: string, label: string) => {
    const waiting = modal.info({ title: `正在扫描 ${label}…`, content: '请稍候', okButtonProps: { style: { display: 'none' } } });
    try {
      const report = await runScan(homeDir, { only: toolId });
      waiting.destroy();
      const r = report[0];
      if (r) {
        if (r.ok) message.success(`${label}：${r.sessions > 0 ? `${r.sessions} 个会话入库` : r.message}`);
        else message.error(`${label}：${r.message}`);
      }
      setLastScan(await getLastScanReport(homeDir));
      bumpDataVersion();
    } catch (e) {
      waiting.destroy();
      message.error((e as Error).message);
    }
  };

  const addCustomSource = async () => {
    if (!newSource.name || !newSource.path) {
      message.warning('请填写名称和路径');
      return;
    }
    const next = [...customSources, { ...newSource, id: `custom:${Date.now().toString(36)}` }];
    await saveCustomSources(homeDir, next);
    setCustomSources(next);
    setNewSource({ id: '', name: '', path: '', format: 'chat-jsonl' });
    message.success('自定义来源已添加，可在上方点击「扫描」入库');
  };

  const removeCustomSource = async (id: string) => {
    const next = customSources.filter((s) => s.id !== id);
    await saveCustomSources(homeDir, next);
    setCustomSources(next);
  };

  const applyPreset = (label: string) => {
    const preset = LLM_PRESETS.find((p) => p.label === label);
    if (preset) llmForm.setFieldsValue({ protocol: preset.protocol, baseUrl: preset.baseUrl, model: preset.model });
  };

  const saveLLM = async () => {
    const v = await llmForm.validateFields();
    await saveLlmConfig(homeDir, v);
    message.success('大模型配置已保存');
  };

  const doTestLLM = async () => {
    const v = await llmForm.validateFields();
    setTesting(true);
    setTestResult(null);
    const r = await testLLM(v);
    setTestResult({ ok: r.ok, message: `${r.message}（${r.latencyMs}ms）` });
    setTesting(false);
  };

  const exportAll = async () => {
    try {
      const db = await initDb(homeDir);
      const r = await sqliteQuery(db, 'SELECT id, tool, title, project, model, created_at, updated_at, messages_json FROM sessions ORDER BY updated_at DESC');
      const path = await exportText(homeDir, `全部会话导出-${dayjs().format('YYYYMMDD-HHmmss')}.json`, JSON.stringify(r.rows, null, 2));
      message.success(`已导出 ${r.rows.length} 个会话：${path}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doClearAll = async () => {
    const db = await initDb(homeDir);
    await clearAllData(db);
    message.success('已清空全部本地数据');
    bumpDataVersion();
  };

  if (loading) return <Typography.Text type="secondary">加载中…</Typography.Text>;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small" title="会话来源（找不到的工具自动跳过，也可手动指定路径）">
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {sources.map((s) => (
            <Card key={s.toolId} size="small" styles={{ body: { padding: '10px 12px' } }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space>
                    <Switch size="small" checked={s.enabled} onChange={(v) => void updateSource(s.toolId, { enabled: v })} />
                    <Typography.Text strong>{s.label}</Typography.Text>
                    {s.foundPaths.length > 0 ? (
                      <Tag color="success">已检测到默认路径</Tag>
                    ) : s.customPaths ? (
                      <Tag color="processing">使用自定义路径</Tag>
                    ) : (
                      <Tag>未检测到 · 可手动指定</Tag>
                    )}
                    {(() => {
                      const r = lastScan.report.find((x) => x.toolId === s.toolId);
                      return r ? <Tag color={r.ok ? (r.sessions > 0 ? 'geekblue' : 'default') : 'error'}>{r.sessions > 0 ? `${r.sessions} 会话` : r.message}</Tag> : null;
                    })()}
                  </Space>
                  <Button size="small" icon={<SyncOutlined />} onClick={() => void scanOne(s.toolId, s.label)}>
                    扫描
                  </Button>
                </Space>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }} code>
                  默认：{s.pathHint}
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
                  <Input
                    size="small"
                    placeholder="自定义路径（可多个，用分号分隔；留空使用默认路径）"
                    defaultValue={s.customPaths}
                    onPressEnter={(e) => void updateSource(s.toolId, { customPaths: (e.target as HTMLInputElement).value })}
                    onBlur={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      if (v !== s.customPaths) void updateSource(s.toolId, { customPaths: v });
                    }}
                  />
                </Space.Compact>
              </Space>
            </Card>
          ))}
        </Space>
      </Card>

      <Card size="small" title="自定义来源（未知格式的工具 / 导出文件目录）">
        {customSources.length > 0 && (
          <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
            {customSources.map((cs) => (
              <Space key={cs.id} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space>
                  <Tag color="geekblue">{cs.name}</Tag>
                  <Typography.Text code style={{ fontSize: 12 }}>{cs.path}</Typography.Text>
                  <Tag>{cs.format}</Tag>
                </Space>
                <Space>
                  <Button size="small" icon={<SyncOutlined />} onClick={() => void scanOne(cs.id, cs.name)}>扫描</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeCustomSource(cs.id)} />
                </Space>
              </Space>
            ))}
          </Space>
        )}
        <Space wrap>
          <Input size="small" style={{ width: 160 }} placeholder="名称，如 dsh" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
          <Input size="small" style={{ width: 380 }} placeholder="目录或文件路径" value={newSource.path} onChange={(e) => setNewSource({ ...newSource, path: e.target.value })} />
          <Select size="small" style={{ width: 170 }} value={newSource.format} onChange={(v) => setNewSource({ ...newSource, format: v })} options={[
            { value: 'chat-jsonl', label: '通用 JSONL/JSON（启发式）' },
            { value: 'claude-jsonl', label: 'Claude Code 格式' },
            { value: 'codex-jsonl', label: 'Codex 格式' },
            { value: 'gemini-json', label: 'Gemini 格式' },
            { value: 'zcode-sqlite', label: 'ZCode SQLite' },
            { value: 'opencode-storage', label: 'OpenCode storage 目录' },
          ]} />
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void addCustomSource()}>添加</Button>
        </Space>
      </Card>

      <Card size="small" title="第三方大模型（生成画像 / 记忆用，OpenAI 兼容协议通吃）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="密钥仅保存在本机数据库，调用经由本地桥接层直连服务商，不上传到任何第三方。"
        />
        <Form form={llmForm} layout="vertical" style={{ maxWidth: 720 }} onFinish={saveLLM}>
          <Form.Item label="快速填充预设">
            <AutoComplete
              options={LLM_PRESETS.map((p) => ({ value: p.label }))}
              placeholder="选择服务商自动填充（可选）"
              onSelect={(v) => applyPreset(String(v))}
              style={{ width: 320 }}
            />
          </Form.Item>
          <Space wrap size="middle">
            <Form.Item name="protocol" label="协议" initialValue="openai">
              <Select style={{ width: 160 }} options={[
                { value: 'openai', label: 'OpenAI 兼容（推荐）' },
                { value: 'anthropic', label: 'Anthropic Claude' },
                { value: 'ollama', label: 'Ollama（本地）' },
              ]} />
            </Form.Item>
            <Form.Item name="baseUrl" label="BaseURL" rules={[{ required: true, message: '必填' }]}>
              <Input style={{ width: 360 }} placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
            <Form.Item name="model" label="模型名" rules={[{ required: true, message: '必填' }]}>
              <Input style={{ width: 240 }} placeholder="deepseek-chat / qwen-plus / glm-4.7…" />
            </Form.Item>
          </Space>
          <Space wrap size="middle" align="start">
            <Form.Item name="apiKey" label="API Key">
              <Input.Password style={{ width: 360 }} placeholder="sk-…" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="temperature" label="Temperature" initialValue={0.4}>
              <Slider min={0} max={1} step={0.1} style={{ width: 160, marginTop: 6 }} />
            </Form.Item>
          </Space>
          <Space>
            <Button type="primary" htmlType="submit">保存配置</Button>
            <Button loading={testing} onClick={() => void doTestLLM()}>测试连接</Button>
          </Space>
        </Form>
        {testResult && (
          <Alert
            style={{ marginTop: 12, maxWidth: 720 }}
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            message={testResult.message}
          />
        )}
      </Card>

      <Card size="small" title="数据管理">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text code style={{ fontSize: 12 }}>本机数据库：{hubPath}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            各工具原始会话文件只读；你的编辑与统计保存在上面这个独立数据库中。
          </Typography.Text>
          <Space wrap style={{ marginTop: 8 }}>
            <Button onClick={() => void exportAll()}>导出全部会话 JSON</Button>
            <Popconfirm
              title="确定清空全部数据？"
              description="将删除已入库的会话、编辑与画像（各工具原始文件不受影响）。"
              okButtonProps={{ danger: true }}
              onConfirm={() => void doClearAll()}
            >
              <Button danger>清空全部数据</Button>
            </Popconfirm>
          </Space>
          {lastScan.at > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              上次扫描：{dayjs(lastScan.at).format('YYYY-MM-DD HH:mm:ss')}
            </Typography.Text>
          )}
        </Space>
      </Card>
    </Space>
  );
}
