import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import EChart from '../components/EChart';
import { useAppStore } from '../store';
import { generateProfileWithLLM, generateRuleProfile, loadLlmConfig, loadProfile } from '../lib/profile';
import { exportText, profileToAgentsMd, profileToMarkdown } from '../lib/export';
import { initDb, saveProfile } from '../lib/db';
import { collectShareData, exportShareCard } from '../lib/sharecard';
import { writeAgentFile, type AgentFileKind, type WriteMode } from '../lib/distill';
import { useI18n } from '../i18n';
import type { UserProfile } from '../types';
import dayjs from 'dayjs';

export default function Profile() {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const { homeDir, dataVersion, bumpDataVersion } = useAppStore();
  const [profile, setProfile] = useState<{ profile: UserProfile; model: string; kind: string; createdAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [editing, setEditing] = useState(false);
  const [memoryEditing, setMemoryEditing] = useState<{ index: number; text: string } | null>(null);
  const [editForm] = Form.useForm();

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      setProfile(await loadProfile(homeDir));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [homeDir, message]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const genRule = async () => {
    setGenerating(true);
    try {
      await generateRuleProfile(homeDir);
      message.success(t('prof.genLocalDone'));
      await load();
      bumpDataVersion();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const genLLM = async () => {
    const cfg = await loadLlmConfig(homeDir);
    if (!cfg || !cfg.baseUrl || !cfg.model) {
      message.warning(t('prof.llmWarn'));
      return;
    }
    setGenerating(true);
    try {
      await generateProfileWithLLM(homeDir, cfg, setGenProgress);
      message.success(t('prof.genLlmDone'));
      await load();
      bumpDataVersion();
    } catch (e) {
      message.error(t('prof.genFail', { msg: (e as Error).message }));
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  const radarOption = useMemo(() => {
    if (!profile) return {};
    const dims = profile.profile.dimensions;
    return {
      tooltip: {},
      radar: {
        indicator: dims.map((d) => ({ name: d.name, max: 5 })),
        radius: '62%',
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: dims.map((d) => d.score),
              name: profile.profile.nickname,
              areaStyle: { opacity: 0.25 },
              itemStyle: { color: '#4f46e5' },
            },
          ],
        },
      ],
    };
  }, [profile]);

  const saveProfileEdits = async (patch: Partial<UserProfile>) => {
    if (!profile) return;
    const db = await initDb(homeDir);
    await saveProfile(db, { ...profile.profile, ...patch }, '手动编辑', profile.kind);
    message.success(t('prof.updated'));
    setEditing(false);
    await load();
  };

  const saveMemory = async (memory: string[]) => {
    if (!profile) return;
    const db = await initDb(homeDir);
    await saveProfile(db, { ...profile.profile, memory }, '手动编辑', profile.kind);
    await load();
    bumpDataVersion();
  };

  const doExport = async (kind: 'md' | 'json' | 'agents' | 'claude') => {
    if (!profile) return;
    const stamp = dayjs().format('YYYYMMDD-HHmmss');
    try {
      let path: string;
      if (kind === 'md') path = await exportText(homeDir, `用户画像-${stamp}.md`, profileToMarkdown(profile.profile, profile));
      else if (kind === 'json') path = await exportText(homeDir, `用户画像-${stamp}.json`, JSON.stringify(profile.profile, null, 2));
      else if (kind === 'agents') path = await exportText(homeDir, 'AGENTS.md', profileToAgentsMd(profile.profile));
      else path = await exportText(homeDir, 'CLAUDE.md', profileToAgentsMd(profile.profile));
      message.success(t('prof.exported', { path }));
    } catch (e) {
      message.error(t('prof.exportFail', { msg: (e as Error).message }));
    }
  };

  const doShareCard = async () => {
    try {
      const data = await collectShareData(homeDir, profile!.profile);
      const file = await exportShareCard(homeDir, data);
      message.success(t('prof.cardDone', { file }));
    } catch (e) {
      message.error(t('prof.genFail', { msg: (e as Error).message }));
    }
  };

  const [writeOpen, setWriteOpen] = useState(false);
  const [writePath, setWritePath] = useState('');
  const [writeKind, setWriteKind] = useState<AgentFileKind>('AGENTS.md');
  const [writeMode, setWriteMode] = useState<WriteMode>('overwrite');

  const doWriteProject = async () => {
    if (!writePath.trim()) {
      message.warning(t('prof.writePathWarn'));
      return;
    }
    try {
      const r = await writeAgentFile(writePath.trim(), writeKind, profileToAgentsMd(p), writeMode);
      message.success(
        t('prof.writeDone', {
          file: r.file,
          bak: r.backup ? `（原文件备份 ${r.backup.split(/[\\/]/).pop()}）` : '',
        }),
      );
      setWriteOpen(false);
    } catch (e) {
      message.error(t('prof.writeFail', { msg: (e as Error).message }));
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

  if (!profile) {
    return (
      <Empty description={t('prof.noProfile')} style={{ marginTop: 80 }}>
        <Space direction="vertical">
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              {t('prof.genRule')}
            </Button>
            <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              {t('prof.llmProfile')}
            </Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('prof.llmHint')}
          </Typography.Text>
        </Space>
      </Empty>
    );
  }

  const p = profile.profile;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        size="small"
        extra={
          <Space wrap>
            <Button size="small" icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue({ nickname: p.nickname, archetype: p.archetype, summary: p.summary }); setEditing(true); }}>
              {t('prof.manualEdit')}
            </Button>
            <Button size="small" icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              {t('prof.regenRule')}
            </Button>
            <Button size="small" type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              {t('prof.llmProfile')}
            </Button>
          </Space>
        }
      >
        {generating && (
          <Alert type="info" showIcon icon={<Spin size="small" />} message={genProgress || t('prof.generating')} style={{ marginBottom: 12 }} />
        )}
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space wrap align="baseline">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {p.nickname}
            </Typography.Title>
            <Tag color="geekblue">{p.archetype}</Tag>
            <Tag color={profile.kind === 'llm' ? 'purple' : 'default'}>
              {profile.kind === 'llm' ? t('prof.kindLlm', { model: profile.model }) : t('prof.kindLocal')}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(profile.createdAt).format('YYYY-MM-DD HH:mm')}
            </Typography.Text>
          </Space>
          <Typography.Paragraph style={{ marginBottom: 0 }}>{p.summary}</Typography.Paragraph>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          <Card size="small" title={t('prof.capability')}>
            <EChart option={radarOption} height={300} />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title={t('prof.dimensions')}>
            <Row gutter={[8, 8]}>
              {p.dimensions.map((d) => (
                <Col xs={24} sm={12} key={d.name}>
                  <Card size="small" style={{ height: '100%' }}>
                    <Statistic title={d.name} value={d.score} suffix="/ 5" valueStyle={{ fontSize: 22 }} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{d.evidence}</Typography.Text>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t('prof.techStack')}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label={t('prof.lang')}>
            <Space wrap>{p.techStack.languages.map((t) => <Tag key={t} color="blue">{t}</Tag>)}{!p.techStack.languages.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('prof.frameworks')}>
            <Space wrap>{p.techStack.frameworks.map((t) => <Tag key={t} color="cyan">{t}</Tag>)}{!p.techStack.frameworks.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('prof.tools')}>
            <Space wrap>{p.techStack.tools.map((t) => <Tag key={t} color="green">{t}</Tag>)}{!p.techStack.tools.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('prof.aiTools')}>
            <Space wrap>{p.techStack.aiTools.map((t) => <Tag key={t} color="purple">{t}</Tag>)}{!p.techStack.aiTools.length && '—'}</Space>
          </Descriptions.Item>
          {p.interests.length > 0 && (
            <Descriptions.Item label={t('prof.interests')}>
              <Space wrap>{p.interests.map((t) => <Tag key={t} color="orange">{t}</Tag>)}</Space>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12}>
          <Card size="small" title={t('prof.workHabits')}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('prof.activeHours')}>{p.workHabits.activeHours || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('prof.sessionStyle')}>{p.workHabits.sessionStyle || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('prof.questionStyle')}>{p.workHabits.questionStyle || '—'}</Descriptions.Item>
            </Descriptions>
            {p.collaborationStyle && (
              <>
                <Typography.Title level={5} style={{ marginTop: 8 }}>{t('prof.collabStyle')}</Typography.Title>
                <Typography.Paragraph type="secondary">{p.collaborationStyle}</Typography.Paragraph>
              </>
            )}
            {p.highlights.length > 0 && (
              <>
                <Typography.Title level={5}>{t('prof.highlights')}</Typography.Title>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  {p.highlights.map((h, i) => (
                    <li key={i}><Typography.Text type="secondary">{h}</Typography.Text></li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={t('prof.memories')}
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setMemoryEditing({ index: -1, text: '' })}
              >
                {t('common.add')}
              </Button>
            }
          >
            <List
              size="small"
              dataSource={p.memory}
              locale={{ emptyText: t('prof.noMemory') }}
              renderItem={(item, index) => (
                <List.Item
                  actions={[
                    <Button key="edit" size="small" type="text" icon={<EditOutlined />} onClick={() => setMemoryEditing({ index, text: item })} />,
                    <Popconfirm key="del" title={t('prof.delMemory')} onConfirm={() => void saveMemory(p.memory.filter((_, i) => i !== index))}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <Typography.Text style={{ fontSize: 13 }}>{item}</Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t('prof.exportTitle')}>
        <Space wrap>
          <Button icon={<PictureOutlined />} type="primary" ghost onClick={() => void doShareCard()}>{t('prof.shareCard')}</Button>
          <Button icon={<DownloadOutlined />} onClick={() => void doExport('md')}>{t('prof.exportMd')}</Button>
          <Button icon={<DownloadOutlined />} onClick={() => void doExport('json')}>{t('prof.exportJson')}</Button>
          <Button icon={<FileTextOutlined />} onClick={() => void doExport('agents')}>AGENTS.md</Button>
          <Button icon={<FileTextOutlined />} onClick={() => void doExport('claude')}>CLAUDE.md</Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => setWriteOpen(true)}>{t('prof.writeProject')}</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          {t('prof.exportNote')}
        </Typography.Paragraph>
      </Card>

      <Modal
        title={t('prof.writeModalTitle')}
        open={writeOpen}
        onCancel={() => setWriteOpen(false)}
        onOk={() => void doWriteProject()}
        okText={t('common.write')}
        cancelText={t('common.cancel')}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Input
            placeholder={t('prof.writeModalPlaceholder')}
            value={writePath}
            onChange={(e) => setWritePath(e.target.value)}
          />
          <Space wrap>
            <Select value={writeKind} onChange={setWriteKind} style={{ width: 160 }} options={[{ value: 'AGENTS.md', label: t('prof.writeKindAgents') }, { value: 'CLAUDE.md', label: t('prof.writeKindClaude') }]} />
            <Select value={writeMode} onChange={setWriteMode} style={{ width: 140 }} options={[{ value: 'overwrite', label: t('prof.writeModeOverwrite') }, { value: 'append', label: t('prof.writeModeAppend') }]} />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('prof.writeModalHint')}
          </Typography.Text>
        </Space>
      </Modal>

      <Modal
        title={t('prof.editModalTitle')}
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={() => editForm.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={640}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => void saveProfileEdits({ nickname: v.nickname, archetype: v.archetype, summary: v.summary })}
        >
          <Form.Item name="nickname" label={t('prof.editNickname')} rules={[{ required: true, message: t('prof.editNicknameReq') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="archetype" label={t('prof.editArchetype')}>
            <Input />
          </Form.Item>
          <Form.Item name="summary" label={t('prof.editSummary')}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={memoryEditing?.index === -1 ? t('prof.memAddTitle') : t('prof.memEditTitle')}
        open={!!memoryEditing}
        onCancel={() => setMemoryEditing(null)}
        onOk={async () => {
          if (!memoryEditing || !profile) return;
          const next = [...p.memory];
          if (memoryEditing.index === -1) next.push(memoryEditing.text.trim());
          else next[memoryEditing.index] = memoryEditing.text.trim();
          setMemoryEditing(null);
          await saveMemory(next.filter(Boolean));
        }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Input.TextArea
          rows={3}
          value={memoryEditing?.text}
          onChange={(e) => memoryEditing && setMemoryEditing({ ...memoryEditing, text: e.target.value })}
          placeholder={t('prof.memPlaceholder')}
        />
      </Modal>
    </Space>
  );
}
