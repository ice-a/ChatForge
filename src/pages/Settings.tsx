import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { sqliteQuery, fsCopy, fsReadFile, fsWriteFile } from '../bridge/client';
import { useI18n } from '../i18n';
import { useAppStore } from '../store';
import { getCustomSources, getLastScanReport, getSourceStatuses, runScan, saveCustomSources, type SourceStatus } from '../lib/scan';
import { saveLlmConfig, loadLlmConfig } from '../lib/profile';
import { testLLM, LLM_PRESETS } from '../lib/llm';
import { clearAllData, getHubPath, initDb, saveSetting } from '../lib/db';
import { DEFAULT_PRICES, loadPrices, savePrices, type ModelPrice } from '../lib/prices';
import {
  applyProvider,
  loadPresets,
  PROVIDER_QUICK_PRESETS,
  readCurrentConfigs,
  savePresets,
  TARGET_LABEL,
  type CurrentConfig,
  type ProviderPreset,
  type ProviderTarget,
} from '../lib/providers';
import { exportText } from '../lib/export';
import type { CustomSource, LlmConfig } from '../types';
import dayjs from 'dayjs';

export default function Settings() {
  const { message, modal } = AntApp.useApp();
  const { t } = useI18n();
  const { homeDir, bumpDataVersion } = useAppStore();
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [customSources, setCustomSources] = useState<CustomSource[]>([]);
  const [lastScan, setLastScan] = useState<{ at: number; report: Awaited<ReturnType<typeof getLastScanReport>>['report'] }>({ at: 0, report: [] });
  const [hubPath, setHubPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newSource, setNewSource] = useState<CustomSource>({ id: '', name: '', path: '', format: 'chat-jsonl' });
  const [priceRows, setPriceRows] = useState<ModelPrice[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [currentConfigs, setCurrentConfigs] = useState<CurrentConfig[]>([]);
  const [newPreset, setNewPreset] = useState<ProviderPreset>({ id: '', name: '', baseUrl: '', apiKey: '', model: '' });
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePath, setRestorePath] = useState('');
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
      setPriceRows(await loadPrices(homeDir));
      setPresets(await loadPresets(homeDir));
      setCurrentConfigs(await readCurrentConfigs(homeDir));
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
    const waiting = modal.info({ title: t('set.scanOne', { label }), content: t('app.scanPreparing'), okButtonProps: { style: { display: 'none' } } });
    try {
      const report = await runScan(homeDir, { only: toolId });
      waiting.destroy();
      const r = report[0];
      if (r) {
        if (r.ok) message.success(r.sessions > 0 ? t('set.scanned', { label, n: r.sessions }) : t('set.scannedMsg', { label, msg: r.message }));
        else message.error(t('set.scannedMsg', { label, msg: r.message }));
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
      message.warning(t('set.addCustomWarn'));
      return;
    }
    const next = [...customSources, { ...newSource, id: `custom:${Date.now().toString(36)}` }];
    await saveCustomSources(homeDir, next);
    setCustomSources(next);
    setNewSource({ id: '', name: '', path: '', format: 'chat-jsonl' });
    message.success(t('set.added'));
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
    message.success(t('set.saveLlmDone'));
  };

  const doTestLLM = async () => {
    const v = await llmForm.validateFields();
    setTesting(true);
    setTestResult(null);
    const r = await testLLM(v);
    setTestResult({ ok: r.ok, message: t('set.testResult', { msg: r.message, ms: r.latencyMs }) });
    setTesting(false);
  };

  const exportAll = async () => {
    try {
      const db = await initDb(homeDir);
      const r = await sqliteQuery(db, 'SELECT id, tool, title, project, model, created_at, updated_at, messages_json FROM sessions ORDER BY updated_at DESC');
      const path = await exportText(homeDir, `全部会话导出-${dayjs().format('YYYYMMDD-HHmmss')}.json`, JSON.stringify(r.rows, null, 2));
      message.success(t('set.exportAllDone', { n: r.rows.length, path }));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doClearAll = async () => {
    const db = await initDb(homeDir);
    await clearAllData(db);
    message.success(t('set.cleared'));
    bumpDataVersion();
  };

  // ---------- 备份 / 恢复（跨设备迁移） ----------

  const backupDb = async () => {
    try {
      const stamp = dayjs().format('YYYYMMDD-HHmmss');
      const dest = `${homeDir}/Downloads/chatforge/chatforge-backup-${stamp}.sqlite`.replace(/\//g, '/');
        await fsCopy(hubPath, dest);
        message.success(t('set.backupDone', { dest }));
    } catch (e) {
      message.error(t('set.backupFail', { msg: (e as Error).message }));
    }
  };

  const restoreDb = async () => {
    if (!restorePath.trim()) {
      message.warning(t('set.restoreWarn'));
      return;
    }
    modal.confirm({
      title: t('set.restoreTitle'),
      content: t('set.restoreContent'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          // 先校验备份文件可读
          await fsReadFile(restorePath.trim(), 1);
          const bak = `${hubPath}.bak-${Date.now()}`;
          await fsCopy(hubPath, bak);
          await fsCopy(restorePath.trim(), hubPath);
          message.success(t('set.restoreDone', { bak: bak.split(/[\\/]/).pop() ?? '' }));
        } catch (e) {
          message.error(t('set.restoreFail', { msg: (e as Error).message }));
        }
      },
    });
  };

  if (loading) return <Typography.Text type="secondary">{t('set.loading')}</Typography.Text>;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Modal
        title={t('set.restoreModalTitle')}
        open={restoreOpen}
        onCancel={() => setRestoreOpen(false)}
        onOk={() => void restoreDb()}
        okText={t('set.restore')}
        okButtonProps={{ danger: true }}
        cancelText={t('common.cancel')}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Input placeholder={t('set.restorePlaceholder')} value={restorePath} onChange={(e) => setRestorePath(e.target.value)} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('set.restoreHint')}
          </Typography.Text>
        </Space>
      </Modal>

      <Card size="small" title={t('set.sources')}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {sources.map((s) => (
            <Card key={s.toolId} size="small" styles={{ body: { padding: '10px 12px' } }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space>
                    <Switch size="small" checked={s.enabled} onChange={(v) => void updateSource(s.toolId, { enabled: v })} />
                    <Typography.Text strong>{s.label}</Typography.Text>
                    {s.foundPaths.length > 0 ? (
                      <Tag color="success">{t('set.detectedDefault')}</Tag>
                    ) : s.customPaths ? (
                      <Tag color="processing">{t('set.usingCustom')}</Tag>
                    ) : (
                      <Tag>{t('set.notDetected')}</Tag>
                    )}
                    {(() => {
                      const r = lastScan.report.find((x) => x.toolId === s.toolId);
                      return r ? <Tag color={r.ok ? (r.sessions > 0 ? 'geekblue' : 'default') : 'error'}>{r.sessions > 0 ? `${r.sessions} 会话` : r.message}</Tag> : null;
                    })()}
                  </Space>
                  <Button size="small" icon={<SyncOutlined />} onClick={() => void scanOne(s.toolId, s.label)}>
                    {t('set.scan')}
                  </Button>
                </Space>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }} code>
                  {t('set.defaultLabel')}{s.pathHint}
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
                  <Input
                    size="small"
                    placeholder={t('set.customPathPlaceholder')}
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

      <Card size="small" title={t('set.customSources')}>
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
                  <Button size="small" icon={<SyncOutlined />} onClick={() => void scanOne(cs.id, cs.name)}>{t('set.scan')}</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeCustomSource(cs.id)} />
                </Space>
              </Space>
            ))}
          </Space>
        )}
        <Space wrap>
          <Input size="small" style={{ width: 160 }} placeholder={t('set.customNamePlaceholder')} value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
          <Input size="small" style={{ width: 380 }} placeholder={t('set.customDirPlaceholder')} value={newSource.path} onChange={(e) => setNewSource({ ...newSource, path: e.target.value })} />
          <Select size="small" style={{ width: 170 }} value={newSource.format} onChange={(v) => setNewSource({ ...newSource, format: v })} options={[
            { value: 'chat-jsonl', label: t('set.formatGeneric') },
            { value: 'claude-jsonl', label: t('set.formatClaude') },
            { value: 'codex-jsonl', label: t('set.formatCodex') },
            { value: 'gemini-json', label: t('set.formatGemini') },
            { value: 'zcode-sqlite', label: t('set.formatZcode') },
            { value: 'opencode-storage', label: t('set.formatOpencode') },
          ]} />
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void addCustomSource()}>{t('common.add')}</Button>
        </Space>
      </Card>

      <Card size="small" title={t('set.llm')}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('set.llmAlert')}
        />
        <Form form={llmForm} layout="vertical" style={{ maxWidth: 720 }} onFinish={saveLLM}>
          <Form.Item label={t('set.preset')}>
            <AutoComplete
              options={LLM_PRESETS.map((p) => ({ value: p.label }))}
              placeholder={t('set.presetPlaceholder')}
              onSelect={(v) => applyPreset(String(v))}
              style={{ width: 320 }}
            />
          </Form.Item>
          <Space wrap size="middle">
            <Form.Item name="protocol" label={t('set.protocol')} initialValue="openai">
              <Select style={{ width: 160 }} options={[
                { value: 'openai', label: t('set.protocolOpenai') },
                { value: 'anthropic', label: t('set.protocolAnthropic') },
                { value: 'ollama', label: t('set.protocolOllama') },
              ]} />
            </Form.Item>
            <Form.Item name="baseUrl" label={t('set.baseUrl')} rules={[{ required: true, message: t('set.baseUrlReq') }]}>
              <Input style={{ width: 360 }} placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
            <Form.Item name="model" label={t('set.modelName')} rules={[{ required: true, message: t('set.baseUrlReq') }]}>
              <Input style={{ width: 240 }} placeholder="deepseek-chat / qwen-plus / glm-4.7…" />
            </Form.Item>
          </Space>
          <Space wrap size="middle" align="start">
            <Form.Item name="apiKey" label={t('set.apiKey')}>
              <Input.Password style={{ width: 360 }} placeholder="sk-…" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="temperature" label={t('set.temperature')} initialValue={0.4}>
              <Slider min={0} max={1} step={0.1} style={{ width: 160, marginTop: 6 }} />
            </Form.Item>
          </Space>
          <Space>
            <Button type="primary" htmlType="submit">{t('set.saveCfg')}</Button>
            <Button loading={testing} onClick={() => void doTestLLM()}>{t('set.testConn')}</Button>
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

      <Card size="small" title={t('set.provider')}>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('set.providerWarn')}
        />
        <div style={{ marginBottom: 12 }}>
          {currentConfigs.map((c) => (
            <Tag key={c.target} style={{ marginBottom: 4 }}>
              {TARGET_LABEL[c.target]}：{c.found ? (c.baseUrl || t('set.defaultOfficial')) : t('set.notInstalled')}
              {c.model ? ` · ${c.model}` : ''}
            </Tag>
          ))}
        </div>
        <Table<ProviderPreset>
          size="small"
          rowKey="id"
          dataSource={presets}
          pagination={false}
          locale={{ emptyText: t('set.providerEmpty') }}
          columns={[
            { title: t('set.colName'), dataIndex: 'name', width: 120 },
            { title: t('set.colBaseUrl'), dataIndex: 'baseUrl', ellipsis: true },
            { title: t('set.colModel'), dataIndex: 'model', width: 130, render: (v: string) => v || '—' },
            {
              title: t('set.colApply'),
              key: 'apply',
              width: 260,
              render: (_: unknown, r: ProviderPreset) => (
                <Space size={4}>
                  {(['claude', 'codex', 'gemini'] as ProviderTarget[]).map((t) => (
                    <Button
                      key={t}
                      size="small"
                      onClick={async () => {
                        const r2 = await applyProvider(homeDir, t, r);
                        if (r2.ok) message.success(`${TARGET_LABEL[t]}：${r2.message}${r2.backup ? '（已备份 ' + r2.backup.split(/[\\/]/).pop() + '）' : ''}`);
                        else message.error(r2.message);
                        setCurrentConfigs(await readCurrentConfigs(homeDir));
                      }}
                    >
                      {TARGET_LABEL[t].replace(' CLI', '').replace(' Code', '')}
                    </Button>
                  ))}
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { const next = presets.filter((p) => p.id !== r.id); await savePresets(homeDir, next); setPresets(next); }} />
                </Space>
              ),
            },
          ]}
        />
        <Space wrap style={{ marginTop: 12 }}>
          <Select
            size="small"
            style={{ width: 220 }}
            placeholder={t('set.quickFill')}
            value={null}
            onChange={(label) => {
              const p = PROVIDER_QUICK_PRESETS.find((x) => x.label === label);
              if (p) setNewPreset({ ...newPreset, name: p.label.replace(/（.*）/, ''), baseUrl: p.baseUrl, model: p.model ?? '' });
            }}
            options={PROVIDER_QUICK_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
          />
          <Input size="small" style={{ width: 130 }} placeholder={t('set.presetName')} value={newPreset.name} onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })} />
          <Input size="small" style={{ width: 300 }} placeholder="BaseURL，如 https://api.deepseek.com" value={newPreset.baseUrl} onChange={(e) => setNewPreset({ ...newPreset, baseUrl: e.target.value })} />
          <Input.Password size="small" style={{ width: 220 }} placeholder={t('set.apiKeyPlaceholder')} value={newPreset.apiKey} onChange={(e) => setNewPreset({ ...newPreset, apiKey: e.target.value })} autoComplete="new-password" />
          <Input size="small" style={{ width: 160 }} placeholder={t('set.modelOptional')} value={newPreset.model} onChange={(e) => setNewPreset({ ...newPreset, model: e.target.value })} />
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={async () => {
              if (!newPreset.name || !newPreset.baseUrl) {
                message.warning(t('set.presetWarn'));
                return;
              }
              const next = [...presets, { ...newPreset, id: `p-${Date.now().toString(36)}` }];
              await savePresets(homeDir, next);
              setPresets(next);
              setNewPreset({ id: '', name: '', baseUrl: '', apiKey: '', model: '' });
              message.success(t('set.presetSaved'));
            }}
          >
            {t('set.addPreset')}
          </Button>
        </Space>
      </Card>

      <Card size="small" title={t('set.prices')}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('set.priceNote')} />
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <Table<ModelPrice>
            size="small"
            rowKey={(r, i) => `${r.key}-${i}`}
            dataSource={priceRows}
            pagination={false}
            columns={[
              {
                title: t('set.priceKey'),
                dataIndex: 'key',
                width: '45%',
                render: (v: string, _r, i) => (
                  <Input size="small" value={v} onChange={(e) => setPriceRows(priceRows.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))} />
                ),
              },
              {
                title: t('set.priceInput'),
                dataIndex: 'input',
                width: '20%',
                render: (v: number, _r, i) => (
                  <Input size="small" type="number" step="0.01" value={v} onChange={(e) => setPriceRows(priceRows.map((p, j) => (j === i ? { ...p, input: Number(e.target.value) } : p)))} />
                ),
              },
              {
                title: t('set.priceOutput'),
                dataIndex: 'output',
                width: '20%',
                render: (v: number, _r, i) => (
                  <Input size="small" type="number" step="0.01" value={v} onChange={(e) => setPriceRows(priceRows.map((p, j) => (j === i ? { ...p, output: Number(e.target.value) } : p)))} />
                ),
              },
              {
                title: '',
                key: 'del',
                width: 50,
                render: (_: unknown, _r, i) => (
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setPriceRows(priceRows.filter((_, j) => j !== i))} />
                ),
              },
            ]}
          />
        </div>
        <Space style={{ marginTop: 12 }}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setPriceRows([...priceRows, { key: '', input: 0, output: 0 }])}>{t('set.addModel')}</Button>
          <Button size="small" type="primary" onClick={async () => { await savePrices(homeDir, priceRows.filter((p) => p.key.trim())); message.success(t('set.pricesSaved')); }}>{t('set.savePrices')}</Button>
          <Button size="small" onClick={async () => { setPriceRows(DEFAULT_PRICES); await savePrices(homeDir, DEFAULT_PRICES); message.success(t('set.pricesReset')); }}>{t('set.resetPrices')}</Button>
        </Space>
      </Card>

      <Card size="small" title={t('set.dataMgmt')}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text code style={{ fontSize: 12 }}>本机数据库：{hubPath}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('set.dataMgmtNote')}
          </Typography.Text>
          <Space wrap style={{ marginTop: 8 }}>
            <Button onClick={() => void exportAll()}>{t('set.exportAll')}</Button>
            <Button onClick={() => void backupDb()}>{t('set.backup')}</Button>
            <Button onClick={() => setRestoreOpen(true)}>{t('set.restore')}</Button>
            <Button type="primary" ghost onClick={() => window.open('https://github.com/ice-a/ChatForge/releases/latest', '_blank')}>
              {t('set.checkUpdate')}
            </Button>
            <Popconfirm
              title={t('set.clearConfirm')}
              description={t('set.clearDesc')}
              okButtonProps={{ danger: true }}
              onConfirm={() => void doClearAll()}
            >
              <Button danger>{t('set.clearAll')}</Button>
            </Popconfirm>
          </Space>
          {lastScan.at > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              {t('set.lastScan', { time: dayjs(lastScan.at).format('YYYY-MM-DD HH:mm:ss') })}
            </Typography.Text>
          )}
        </Space>
      </Card>
    </Space>
  );
}
