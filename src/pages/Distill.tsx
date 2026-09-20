import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CloudDownloadOutlined,
  CopyOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAppStore } from '../store';
import { useI18n } from '../i18n';
import { loadProfile } from '../lib/profile';
import {
  distillRule,
  distillWithLLM,
  exportSkill,
  INSTALL_TARGETS,
  installSkill,
  listEvidence,
  sanitizeSkillName,
  skillNameValid,
  type DistilledSkill,
} from '../lib/distill';
import type { SessionRow } from '../types';
import dayjs from 'dayjs';

export default function Distill() {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const { homeDir, dataVersion } = useAppStore();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof loadProfile>>>();
  const [loading, setLoading] = useState(true);
  const [memSelected, setMemSelected] = useState<string[]>([]);
  const [includeTech, setIncludeTech] = useState(true);
  const [includeCollab, setIncludeCollab] = useState(true);
  const [evidence, setEvidence] = useState<SessionRow[]>([]);
  const [evSelected, setEvSelected] = useState<React.Key[]>([]);
  const [skill, setSkill] = useState<DistilledSkill | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [descInput, setDescInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      const p = await loadProfile(homeDir);
      setProfile(p);
      setMemSelected(p?.profile.memory ?? []);
      setEvidence(await listEvidence(homeDir));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [homeDir, message]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const memory = profile?.profile.memory ?? [];
  const evidenceRows = useMemo(
    () =>
      evSelected
        .map((k) => evidence.find((r) => r.id === k))
        .filter((r): r is SessionRow => !!r)
        .map((r) => `[${r.tool}·${dayjs(r.updated_at).format('YYYY-MM-DD')}${r.project ? '·' + r.project : ''}] ${(r.first_user_text ?? '').replace(/\s+/g, ' ').slice(0, 260)}`),
    [evSelected, evidence],
  );

  const buildOpts = () => ({
    memory: memory.filter((m) => memSelected.includes(m)),
    includeTechStack: includeTech,
    includeCollab,
    sessionEvidence: evidenceRows,
    nameHint: nameInput || undefined,
  });

  const applySkill = (s: DistilledSkill) => {
    setSkill(s);
    setNameInput(s.name);
    setContentInput(s.content);
    setDescInput(s.description);
  };

  const genLLM = async () => {
    setGenerating(true);
    try {
      applySkill(await distillWithLLM(homeDir, buildOpts(), setGenProgress));
      message.success(t('dist.distillDone'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  const genRule = async () => {
    setGenerating(true);
    try {
      applySkill(await distillRule(homeDir, buildOpts()));
      message.success(t('dist.ruleDone'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const validName = skillNameValid(nameInput);

  const doExport = async () => {
    if (!validName) {
      message.warning(t('dist.nameWarn'));
      return;
    }
    try {
      const dir = await exportSkill(homeDir, nameInput, contentInput);
      message.success(t('dist.exportDone', { dir, name: nameInput }));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doInstall = async (targetId: string, label: string) => {
    if (!validName) {
      message.warning(t('dist.nameWarn2'));
      return;
    }
    const target = INSTALL_TARGETS.find((t) => t.id === targetId)!;
    try {
      const file = await installSkill(homeDir, target, nameInput, contentInput);
      message.success(t('dist.installDone', { label, file }));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(contentInput);
      message.success(t('dist.copied'));
    } catch {
      message.error(t('dist.copyFail'));
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

  const evColumns: ColumnsType<SessionRow> = [
    { title: t('dist.col.title'), dataIndex: 'title', key: 'title', ellipsis: true },
    { title: t('dist.col.tool'), dataIndex: 'tool', key: 'tool', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: t('dist.col.project'), dataIndex: 'project', key: 'project', width: 130, ellipsis: true, render: (v: string | null) => v ?? '—' },
    { title: t('dist.col.updated'), dataIndex: 'updated_at', key: 'updated_at', width: 130, render: (v: number) => dayjs(v).format('MM-DD HH:mm') },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message={t('dist.title')}
      />

      <Card size="small" title={t('dist.step1')}>
        {memory.length === 0 ? (
          <Typography.Text type="secondary">
            {t('dist.noMem')}
          </Typography.Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong>
              {t('dist.memories')}（{memSelected.length}/{memory.length} {t('dist.selected')}）
            </Typography.Text>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px' }}>
              {memory.map((m, i) => (
                <div key={i}>
                  <Checkbox
                    checked={memSelected.includes(m)}
                    onChange={(e) =>
                      setMemSelected(e.target.checked ? [...memSelected, m] : memSelected.filter((x) => x !== m))
                    }
                  >
                    <Typography.Text style={{ fontSize: 13 }}>{m}</Typography.Text>
                  </Checkbox>
                </div>
              ))}
            </div>
            <Space wrap>
              <Checkbox checked={includeTech} onChange={(e) => setIncludeTech(e.target.checked)}>
                {t('dist.includeTech')}
              </Checkbox>
              <Checkbox checked={includeCollab} onChange={(e) => setIncludeCollab(e.target.checked)}>
                {t('dist.includeCollab')}
              </Checkbox>
              <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setPickOpen(true)}>
                {t('dist.pickEvidence', { n: evSelected.length })}
              </Button>
            </Space>
          </Space>
        )}
      </Card>

      <Card
        size="small"
        title={t('dist.step2')}
        extra={
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              {t('dist.ruleDistill')}
            </Button>
            <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              {t('dist.llmDistill')}
            </Button>
          </Space>
        }
      >
        {generating && <Alert type="info" showIcon icon={<Spin size="small" />} message={genProgress || t('dist.distilling')} />}
        {skill && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Space wrap size="middle" align="start">
              <Form.Item label={t('dist.skillName')} validateStatus={validName ? undefined : 'error'} style={{ marginBottom: 8 }}>
                <Input
                  style={{ width: 280 }}
                  value={nameInput}
                  onChange={(e) => setNameInput(sanitizeSkillName(e.target.value))}
                  prefix={<ExperimentOutlined />}
                />
              </Form.Item>
              <Form.Item label={t('dist.installLoc')} style={{ marginBottom: 8 }}>
                <Typography.Text code style={{ fontSize: 12 }}>
                  ~/.agents/skills/{nameInput || '<name>'}/SKILL.md
                </Typography.Text>
              </Form.Item>
            </Space>
            <Form.Item label={t('dist.descLabel')}>
              <Input.TextArea rows={2} value={descInput} onChange={(e) => setDescInput(e.target.value)} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  <span>{t('dist.bodyLabel')}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('dist.bodyHint')}
                  </Typography.Text>
                </Space>
              }
            >
              <Input.TextArea rows={16} value={contentInput} onChange={(e) => setContentInput(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
            <Space wrap>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={doExport}>
                {t('dist.exportFolder')}
              </Button>
              <Button icon={<CopyOutlined />} onClick={doCopy}>
                {t('dist.copy')}
              </Button>
              <Button onClick={() => setInstallOpen(true)}>{t('dist.install')}</Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              {t('dist.shareNote', { name: nameInput || '<name>' })}
            </Typography.Paragraph>
          </Form>
        )}
        {!skill && !generating && (
          <Typography.Text type="secondary">
            {t('dist.noSkill')}
          </Typography.Text>
        )}
      </Card>

      <Modal
        title={t('dist.pickTitle')}
        open={pickOpen}
        onCancel={() => setPickOpen(false)}
        onOk={() => setPickOpen(false)}
        width={720}
      >
        <Table<SessionRow>
          size="small"
          rowKey="id"
          columns={evColumns}
          dataSource={evidence}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          rowSelection={{ selectedRowKeys: evSelected, onChange: setEvSelected }}
        />
      </Modal>

      <Modal
        title={t('dist.installTitle')}
        open={installOpen}
        onCancel={() => setInstallOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('dist.installHint', { name: nameInput || '<name>' })}
          </Typography.Text>
          {INSTALL_TARGETS.map((tg) => (
            <Button key={tg.id} block onClick={() => void doInstall(tg.id, tg.label)}>
              {t('dist.installTo', { label: tg.label })}
            </Button>
          ))}
        </Space>
      </Modal>
    </Space>
  );
}
