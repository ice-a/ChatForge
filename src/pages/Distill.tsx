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
      message.success('蒸馏完成，可编辑后导出');
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
      message.success('模板蒸馏完成（无 LLM），可编辑后导出');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const validName = skillNameValid(nameInput);

  const doExport = async () => {
    if (!validName) {
      message.warning('名称需为小写字母开头的 kebab-case（a-z 0-9 -）');
      return;
    }
    try {
      const dir = await exportSkill(homeDir, nameInput, contentInput);
      message.success(`已导出：${dir}\\SKILL.md（把整个 ${nameInput} 文件夹发给对方即可分享）`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doInstall = async (targetId: string, label: string) => {
    if (!validName) {
      message.warning('名称需为小写字母开头的 kebab-case');
      return;
    }
    const target = INSTALL_TARGETS.find((t) => t.id === targetId)!;
    try {
      const file = await installSkill(homeDir, target, nameInput, contentInput);
      message.success(`已安装到 ${label}：${file}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(contentInput);
      message.success('SKILL.md 内容已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择内容复制');
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

  const evColumns: ColumnsType<SessionRow> = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '工具', dataIndex: 'tool', key: 'tool', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: '项目', dataIndex: 'project', key: 'project', width: 130, ellipsis: true, render: (v: string | null) => v ?? '—' },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 130, render: (v: number) => dayjs(v).format('MM-DD HH:mm') },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="蒸馏大师：把用户画像 / 智能体记忆 / 会话证据蒸馏成一个符合 skill 规范的 SKILL.md，装进任何 AI 编程工具（ZCode / Claude Code / Codex / OpenCode…），也可以直接把文件夹分享给其他人。"
      />

      <Card size="small" title="第一步 · 选择蒸馏素材">
        {memory.length === 0 ? (
          <Typography.Text type="secondary">
            还没有画像/记忆。请先到「用户画像」页生成画像（记忆条目将出现在这里）。
          </Typography.Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong>记忆条目（{memSelected.length}/{memory.length} 已选）</Typography.Text>
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
                包含技术栈画像
              </Checkbox>
              <Checkbox checked={includeCollab} onChange={(e) => setIncludeCollab(e.target.checked)}>
                包含协作风格
              </Checkbox>
              <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setPickOpen(true)}>
                选择会话证据（{evSelected.length}）
              </Button>
            </Space>
          </Space>
        )}
      </Card>

      <Card
        size="small"
        title="第二步 · 蒸馏"
        extra={
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={generating} onClick={genRule}>
              模板蒸馏（免配置）
            </Button>
            <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={genLLM}>
              LLM 蒸馏（推荐）
            </Button>
          </Space>
        }
      >
        {generating && <Alert type="info" showIcon icon={<Spin size="small" />} message={genProgress || '蒸馏中…'} />}
        {skill && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Space wrap size="middle" align="start">
              <Form.Item label="Skill 名称（= 目录名，kebab-case）" validateStatus={validName ? undefined : 'error'} style={{ marginBottom: 8 }}>
                <Input
                  style={{ width: 280 }}
                  value={nameInput}
                  onChange={(e) => setNameInput(sanitizeSkillName(e.target.value))}
                  prefix={<ExperimentOutlined />}
                />
              </Form.Item>
              <Form.Item label="分享/安装位置" style={{ marginBottom: 8 }}>
                <Typography.Text code style={{ fontSize: 12 }}>
                  ~/.agents/skills/{nameInput || '<name>'}/SKILL.md
                </Typography.Text>
              </Form.Item>
            </Space>
            <Form.Item label="description（触发信号，其他工具据此决定何时加载）">
              <Input.TextArea rows={2} value={descInput} onChange={(e) => setDescInput(e.target.value)} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  <span>SKILL.md 正文</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    规范：frontmatter 仅 name + description；正文祈使句 + 示例，&lt; 500 行
                  </Typography.Text>
                </Space>
              }
            >
              <Input.TextArea rows={16} value={contentInput} onChange={(e) => setContentInput(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
            <Space wrap>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={doExport}>
                导出为可分享文件夹
              </Button>
              <Button icon={<CopyOutlined />} onClick={doCopy}>
                复制内容
              </Button>
              <Button onClick={() => setInstallOpen(true)}>安装到本机工具…</Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              分享方式：把导出的 <code>{nameInput}/</code> 整个文件夹发给对方，对方放进自己的
              <code> ~/.agents/skills/</code>（或 <code>~/.zcode/skills/</code>、<code>~/.claude/skills/</code>）即可生效。
            </Typography.Paragraph>
          </Form>
        )}
        {!skill && !generating && (
          <Typography.Text type="secondary">
            选择素材后点「LLM 蒸馏」或「模板蒸馏」。生成后可自由编辑再导出。
          </Typography.Text>
        )}
      </Card>

      <Modal
        title="选择会话证据（蒸馏时会作为素材提供给 LLM）"
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
        title="安装到本机工具"
        open={installOpen}
        onCancel={() => setInstallOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            安装 = 写入 <code>{nameInput}/SKILL.md</code> 到对应目录。同名会覆盖，请确认名称正确。
          </Typography.Text>
          {INSTALL_TARGETS.map((t) => (
            <Button key={t.id} block onClick={() => void doInstall(t.id, t.label)}>
              安装到 {t.label}
            </Button>
          ))}
        </Space>
      </Modal>
    </Space>
  );
}
