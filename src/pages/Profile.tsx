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
import type { UserProfile } from '../types';
import dayjs from 'dayjs';

export default function Profile() {
  const { message } = AntApp.useApp();
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
      message.success('本地规则画像已生成');
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
      message.warning('请先在「设置 → 大模型」中配置第三方大模型（BaseURL / Key / 模型名）');
      return;
    }
    setGenerating(true);
    try {
      await generateProfileWithLLM(homeDir, cfg, setGenProgress);
      message.success('LLM 深度画像已生成');
      await load();
      bumpDataVersion();
    } catch (e) {
      message.error(`生成失败：${(e as Error).message}`);
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
    message.success('画像已更新');
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
      message.success(`已导出：${path}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doShareCard = async () => {
    try {
      const data = await collectShareData(homeDir, profile!.profile);
      const file = await exportShareCard(homeDir, data);
      message.success(`分享卡片已生成并开始下载（${file}）`);
    } catch (e) {
      message.error(`生成失败：${(e as Error).message}`);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

  if (!profile) {
    return (
      <Empty description="还没有用户画像" style={{ marginTop: 80 }}>
        <Space direction="vertical">
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              生成规则版画像（本地，免配置）
            </Button>
            <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              生成 LLM 深度画像
            </Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            LLM 深度画像需先在「设置 → 大模型」配置第三方模型（DeepSeek / Qwen / GLM / Kimi / OpenAI / Ollama…）
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
              手动编辑
            </Button>
            <Button size="small" icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              重新生成规则版
            </Button>
            <Button size="small" type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              LLM 深度画像
            </Button>
          </Space>
        }
      >
        {generating && (
          <Alert type="info" showIcon icon={<Spin size="small" />} message={genProgress || '生成中…'} style={{ marginBottom: 12 }} />
        )}
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space wrap align="baseline">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {p.nickname}
            </Typography.Title>
            <Tag color="geekblue">{p.archetype}</Tag>
            <Tag color={profile.kind === 'llm' ? 'purple' : 'default'}>
              {profile.kind === 'llm' ? `LLM：${profile.model}` : '本地规则'}
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
          <Card size="small" title="能力雷达">
            <EChart option={radarOption} height={300} />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title="多维度评估">
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

      <Card size="small" title="技术栈画像">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="编程语言">
            <Space wrap>{p.techStack.languages.map((t) => <Tag key={t} color="blue">{t}</Tag>)}{!p.techStack.languages.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label="框架/库">
            <Space wrap>{p.techStack.frameworks.map((t) => <Tag key={t} color="cyan">{t}</Tag>)}{!p.techStack.frameworks.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label="工具/平台">
            <Space wrap>{p.techStack.tools.map((t) => <Tag key={t} color="green">{t}</Tag>)}{!p.techStack.tools.length && '—'}</Space>
          </Descriptions.Item>
          <Descriptions.Item label="AI 相关">
            <Space wrap>{p.techStack.aiTools.map((t) => <Tag key={t} color="purple">{t}</Tag>)}{!p.techStack.aiTools.length && '—'}</Space>
          </Descriptions.Item>
          {p.interests.length > 0 && (
            <Descriptions.Item label="关注领域">
              <Space wrap>{p.interests.map((t) => <Tag key={t} color="orange">{t}</Tag>)}</Space>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12}>
          <Card size="small" title="工作习惯">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="活跃时段">{p.workHabits.activeHours || '—'}</Descriptions.Item>
              <Descriptions.Item label="会话风格">{p.workHabits.sessionStyle || '—'}</Descriptions.Item>
              <Descriptions.Item label="提问风格">{p.workHabits.questionStyle || '—'}</Descriptions.Item>
            </Descriptions>
            {p.collaborationStyle && (
              <>
                <Typography.Title level={5} style={{ marginTop: 8 }}>与 AI 协作风格</Typography.Title>
                <Typography.Paragraph type="secondary">{p.collaborationStyle}</Typography.Paragraph>
              </>
            )}
            {p.highlights.length > 0 && (
              <>
                <Typography.Title level={5}>亮点与建议</Typography.Title>
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
            title="智能体记忆（AGENTS.md / CLAUDE.md）"
            extra={
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setMemoryEditing({ index: -1, text: '' })}
              >
                添加
              </Button>
            }
          >
            <List
              size="small"
              dataSource={p.memory}
              locale={{ emptyText: '暂无记忆条目' }}
              renderItem={(item, index) => (
                <List.Item
                  actions={[
                    <Button key="edit" size="small" type="text" icon={<EditOutlined />} onClick={() => setMemoryEditing({ index, text: item })} />,
                    <Popconfirm key="del" title="删除这条记忆？" onConfirm={() => void saveMemory(p.memory.filter((_, i) => i !== index))}>
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

      <Card size="small" title="导出">
        <Space wrap>
          <Button icon={<PictureOutlined />} type="primary" ghost onClick={() => void doShareCard()}>生成分享卡片</Button>
          <Button icon={<DownloadOutlined />} onClick={() => void doExport('md')}>画像 Markdown</Button>
          <Button icon={<DownloadOutlined />} onClick={() => void doExport('json')}>画像 JSON</Button>
          <Button icon={<FileTextOutlined />} onClick={() => void doExport('agents')}>AGENTS.md</Button>
          <Button icon={<FileTextOutlined />} onClick={() => void doExport('claude')}>CLAUDE.md</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          导出写入 Downloads/chatforge 目录（开发模式下写入用户目录）。
        </Typography.Paragraph>
      </Card>

      <Modal
        title="手动编辑画像"
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={() => editForm.submit()}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => void saveProfileEdits({ nickname: v.nickname, archetype: v.archetype, summary: v.summary })}
        >
          <Form.Item name="nickname" label="称呼" rules={[{ required: true, message: '请输入称呼' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="archetype" label="开发者类型">
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="总述">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={memoryEditing?.index === -1 ? '添加记忆条目' : '编辑记忆条目'}
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
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          rows={3}
          value={memoryEditing?.text}
          onChange={(e) => memoryEditing && setMemoryEditing({ ...memoryEditing, text: e.target.value })}
          placeholder="例如：用户偏好使用 pnpm 与 TypeScript，回答请附示例代码。"
        />
      </Modal>
    </Space>
  );
}
