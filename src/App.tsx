import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  REACTION_VALUES,
  type AttachmentReference,
  type BoardRecord,
  createBoardId,
  type ReactionValue,
  type ReducedBoard,
  type ReducedPost,
  type ReducedThread,
  type ReducedTopic,
  type TipRecord,
} from './boardModel';
import { copyTextToClipboard } from './clipboard';
import {
  createEdit,
  createModeration,
  createPollName,
  createPost,
  createReaction,
  createThread,
  createTopic,
  loadAccountContext,
  loadBoard,
  loadNativePoll,
  publishTipReceipt,
  publishNativePoll,
  publishRecord,
  recordConfirmationTarget,
  selectAndPublishAttachmentWithResult,
  sendTipPayment,
  transactionConfirmationTarget,
  voteNativePoll,
  type AccountContext,
  type NativePoll,
  type NativePollVotes,
} from './boardService';
import {
  applyDisplaySettings,
  getDisplaySettingsUpdateFromMessage,
  getInitialDisplaySettings,
  type QdnDisplaySettings,
} from './displaySettings';
import {
  buildRouteLink,
  readRoute,
  resolvePostTarget,
  routeUrl,
  shouldReplaceHistory,
  type BoardsRoute as Route,
  type NavigationIntent,
} from './deepLink';
import {
  transactionTarget,
  waitForConfirmedWrite,
  type ConfirmationResult,
  type ConfirmationTarget,
} from './pendingWrite';
import { getBridgeState, hasAction, qdnRequest } from './qdnRequest';
import { Reference } from './Reference';
import type { BridgeState, NodeStatus } from './types';

type Composer =
  | { kind: 'edit-post'; post: ReducedPost }
  | { kind: 'edit-thread'; thread: ReducedThread }
  | { kind: 'edit-topic'; topic: ReducedTopic }
  | { kind: 'thread'; topicId: string }
  | { kind: 'tip'; target: ReducedPost | ReducedThread; targetKind: 'post' | 'thread' }
  | { kind: 'topic' }
  | null;

const EMPTY_BOARD: ReducedBoard = {
  admins: [],
  moderators: [],
  posts: [],
  threads: [],
  topics: [],
};

const reactionLabels: Record<ReactionValue, string> = {
  agree: 'Agree',
  insightful: 'Insightful',
  laugh: 'Laugh',
  like: 'Like',
  support: 'Support',
};

type StatusSetter = (message: string) => void;

function confirmationError(label: string, result: Exclude<ConfirmationResult, { phase: 'confirmed' }>) {
  if (result.phase === 'timeout') {
    return new Error(
      `${label} is still awaiting network confirmation. It may confirm later; check again before resubmitting.`,
    );
  }

  return new Error(result.error || `${label} could not be confirmed.`);
}

async function requireConfirmation(target: ConfirmationTarget, label: string) {
  const result = await waitForConfirmedWrite(target);

  if (result.phase !== 'confirmed') {
    throw confirmationError(label, result);
  }
}

async function confirmTransactionResult(result: unknown, label: string, setStatus: StatusSetter) {
  const target = transactionTarget(result);

  if (!target) {
    throw new Error(`${label} was submitted, but Home did not return a transaction signature.`);
  }

  setStatus(`${label} submitted. Awaiting network confirmation…`);
  await requireConfirmation(target, label);
}

async function confirmQdnPublication(
  result: unknown,
  target: ConfirmationTarget,
  label: string,
  setStatus: StatusSetter,
) {
  await confirmTransactionResult(result, label, setStatus);
  setStatus(`${label} confirmed. Preparing the QDN resource…`);
  await requireConfirmation(target, label);
}

async function publishConfirmedRecord(
  name: string,
  record: BoardRecord,
  label: string,
  setStatus: StatusSetter,
) {
  setStatus(`Waiting for Home approval to publish ${label.toLowerCase()}…`);
  const result = await publishRecord(name, record);
  await confirmQdnPublication(result, recordConfirmationTarget(name, record), label, setStatus);
  return result;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
}

function initials(name: string) {
  return name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function richTextParts(body: string) {
  const matches = body.split(/((?:https?:\/\/|qdn:\/\/)[^\s<]+)/gi);
  return matches.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a href={part} key={`${part}-${index}`} rel="noreferrer" target="_blank">
          {part}
        </a>
      );
    }

    if (/^qdn:\/\//i.test(part)) {
      return (
        <a href={part} key={`${part}-${index}`}>
          {part}
        </a>
      );
    }

    return <span key={index}>{part}</span>;
  });
}

function RichBody({ body }: { body: string }) {
  return (
    <div className="rich-body">
      {body.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${paragraph.slice(0, 16)}-${index}`}>{richTextParts(paragraph)}</p>
      ))}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name) || '?'}
    </span>
  );
}

function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'danger' | 'info' | 'success' | 'warning';
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: AttachmentReference[] }) {
  if (!attachments.length) return null;

  return (
    <div className="attachment-list" aria-label="Attachments">
      {attachments.map((attachment) => (
        <a
          className="attachment"
          href={`qdn://${attachment.service}/${attachment.name}/${attachment.identifier}`}
          key={`${attachment.name}:${attachment.identifier}`}
        >
          <span className="attachment__icon">↗</span>
          <span>
            <strong>{attachment.filename}</strong>
            <small>
              {attachment.service}
              {attachment.size ? ` · ${compactNumber(attachment.size)}B` : ''}
            </small>
          </span>
        </a>
      ))}
    </div>
  );
}

function ReactionBar({
  counts,
  currentName,
  currentReaction,
  disabled,
  onReact,
}: {
  counts: Record<ReactionValue, number>;
  currentName?: string;
  currentReaction?: ReactionValue;
  disabled: boolean;
  onReact: (reaction: ReactionValue | null) => void;
}) {
  return (
    <div className="reaction-bar" aria-label="Reactions">
      {REACTION_VALUES.map((reaction) => {
        const active = currentReaction === reaction;
        return (
          <button
            aria-label={`${active ? 'Remove' : 'Add'} ${reactionLabels[reaction]} reaction${
              currentName ? ` as ${currentName}` : ''
            }`}
            aria-pressed={active}
            className={`reaction-button${active ? ' is-active' : ''}`}
            disabled={disabled}
            key={reaction}
            onClick={() => onReact(active ? null : reaction)}
            type="button"
          >
            <span>{reactionLabels[reaction]}</span>
            {counts[reaction] ? <strong>{counts[reaction]}</strong> : null}
          </button>
        );
      })}
    </div>
  );
}

function PollCard({
  canVote,
  pollName,
}: {
  canVote: boolean;
  pollName: string;
}) {
  const [poll, setPoll] = useState<NativePoll | null>(null);
  const [votes, setVotes] = useState<NativePollVotes | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState('Loading the on-chain poll…');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const result = await loadNativePoll(pollName);
      setPoll(result.poll);
      setVotes(result.votes);
      setMessage('');
    } catch {
      setMessage('The poll transaction is pending or not available from this node yet.');
    }
  }

  useEffect(() => {
    void refresh();
  }, [pollName]);

  async function submitVote() {
    if (!poll || selected === null) return;
    setBusy(true);
    setMessage('');

    try {
      const result = await voteNativePoll(poll.pollId, [selected + 1]);
      await confirmTransactionResult(result, 'Vote', setMessage);
      setMessage('Vote confirmed. Refreshing results…');
      await refresh();
      setMessage('Your vote has been recorded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!poll) {
    return <Notice>{message}</Notice>;
  }

  const counts = new Map((votes?.voteCounts ?? []).map((item) => [item.optionName, item.voteCount]));
  const total = votes?.totalVoters ?? [...counts.values()].reduce((sum, count) => sum + count, 0);

  return (
    <section className="poll-card" aria-labelledby={`poll-${poll.pollId}`}>
      <div className="poll-card__heading">
        <div>
          <span className="eyebrow">Native Qortium poll</span>
          <h3 id={`poll-${poll.pollId}`}>{poll.description || poll.pollName}</h3>
        </div>
        <span className="status-chip">#{poll.pollId}</span>
      </div>
      <fieldset disabled={!canVote || busy}>
        <legend className="sr-only">{poll.description || poll.pollName}</legend>
        {poll.pollOptions.map((option, index) => {
          const count = counts.get(option.optionName) ?? 0;
          const percent = total ? Math.round((count / total) * 100) : 0;
          return (
            <label className="poll-option" key={option.optionName}>
              <span className="poll-option__choice">
                <input
                  checked={selected === index}
                  name={`poll-${poll.pollId}`}
                  onChange={() => setSelected(index)}
                  type="radio"
                />
                <strong>{option.optionName}</strong>
              </span>
              <span className="poll-option__result">
                <span style={{ width: `${percent}%` }} />
                <small>
                  {count} · {percent}%
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="poll-card__footer">
        <span>{total} voter{total === 1 ? '' : 's'} · public signed transactions</span>
        <button disabled={!canVote || selected === null || busy} onClick={submitVote} type="button">
          {busy ? 'Submitting…' : 'Vote'}
        </button>
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}

function ComposerModal({
  canAttach,
  canCreatePoll,
  composer,
  name,
  onClose,
  onPublished,
}: {
  canAttach: boolean;
  canCreatePoll: boolean;
  composer: Exclude<Composer, null>;
  name: string;
  onClose: () => void;
  onPublished: (route?: Route) => Promise<void>;
}) {
  const isTopic = composer.kind === 'topic' || composer.kind === 'edit-topic';
  const isThread = composer.kind === 'thread' || composer.kind === 'edit-thread';
  const editEntity =
    composer.kind === 'edit-topic'
      ? composer.topic
      : composer.kind === 'edit-thread'
        ? composer.thread
        : composer.kind === 'edit-post'
          ? composer.post
          : null;
  const [title, setTitle] = useState(
    composer.kind === 'edit-topic'
      ? composer.topic.title
      : composer.kind === 'edit-thread'
        ? composer.thread.title
        : '',
  );
  const [body, setBody] = useState(
    composer.kind === 'edit-topic'
      ? composer.topic.description
      : composer.kind === 'edit-thread'
        ? composer.thread.body
        : composer.kind === 'edit-post'
          ? composer.post.body
          : '',
  );
  const [tags, setTags] = useState(composer.kind === 'edit-topic' ? composer.topic.tags.join(', ') : '');
  const [attachments, setAttachments] = useState<AttachmentReference[]>([]);
  const [threadId] = useState(() => createBoardId());
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollEnd, setPollEnd] = useState('');
  const [confirmedPollName, setConfirmedPollName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'danger' | 'info' | 'success'>('info');

  function setStatus(nextMessage: string) {
    setMessageTone('info');
    setMessage(nextMessage);
  }

  function closeComposer() {
    const confirmedParts = [
      confirmedPollName ? 'native poll' : '',
      attachments.length > 0 ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);

    if (confirmedParts.length > 0) {
      const description = confirmedParts.join(' and ');
      if (
        !window.confirm(
          `The ${description} ${confirmedParts.length === 1 ? 'is' : 'are'} already published, but this discussion record is not. Close and leave ${confirmedParts.length === 1 ? 'it' : 'them'} unlinked?`,
        )
      ) {
        return;
      }
    }

    onClose();
  }

  async function addAttachment() {
    setBusy(true);
    setStatus('Select a file to publish through Qortium Home…');
    try {
      const published = await selectAndPublishAttachmentWithResult(name);
      if (published) {
        await confirmQdnPublication(
          published.publishResult,
          published.confirmationTarget,
          'Attachment publication',
          setStatus,
        );
        setAttachments((current) => [...current, published.attachment]);
        setMessageTone('success');
        setMessage('Attachment confirmed and ready to include.');
      } else {
        setMessage('');
      }
    } catch (error) {
      setMessageTone('danger');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      if (composer.kind === 'topic') {
        const topic = createTopic(
          title,
          body,
          tags.split(',').map((tag) => tag.trim()),
        );
        await publishConfirmedRecord(name, topic, 'Topic publication', setStatus);
        await onPublished({ kind: 'topic', topicId: topic.id });
        return;
      }

      if (composer.kind === 'thread') {
        let poll: ReducedThread['poll'] = null;
        const validOptions = pollOptions.map((option) => option.trim()).filter(Boolean);

        if (pollEnabled) {
          if (!canCreatePoll) {
            throw new Error('This Qortium Home version cannot create native polls.');
          }
          if (validOptions.length < 2) {
            throw new Error('A native poll needs at least two options.');
          }
          const pollName = confirmedPollName || createPollName(threadId);

          if (!confirmedPollName) {
            setStatus('Waiting for Home approval to create the native poll…');
            const pollResult = await publishNativePoll({
              description: title,
              endTime: pollEnd ? new Date(pollEnd).getTime() : undefined,
              options: validOptions,
              pollName,
            });
            await confirmTransactionResult(pollResult, 'Native poll', setStatus);
            setConfirmedPollName(pollName);
          }

          poll = { pollName };
        }

        const thread = createThread({
          attachments,
          body,
          id: threadId,
          poll,
          title,
          topicId: composer.topicId,
        });
        await publishConfirmedRecord(name, thread, 'Thread publication', setStatus);
        await onPublished({ kind: 'thread', threadId: thread.id });
        return;
      }

      if (editEntity) {
        const edit = createEdit({
          body,
          tags: isTopic ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
          targetId: editEntity.id,
          targetKind: editEntity.kind,
          title: 'title' in editEntity ? title : undefined,
        });
        await publishConfirmedRecord(
          name,
          edit,
          'Edit publication',
          setStatus,
        );
        await onPublished();
      }
    } catch (error) {
      setMessageTone('danger');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="composer-title" aria-modal="true" className="modal" role="dialog">
        <header className="modal__header">
          <div>
            <span className="eyebrow">{editEntity ? 'Edit published record' : 'New discussion'}</span>
            <h2 id="composer-title">
              {isTopic ? 'Topic' : isThread ? 'Thread' : 'Post'}
            </h2>
          </div>
          <button aria-label="Close composer" className="button button--quiet" onClick={closeComposer} type="button">
            Close
          </button>
        </header>
        <form className="composer-form" onSubmit={submit}>
          {(isTopic || isThread) && (
            <label>
              <span>Title</span>
              <input
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>
          )}
          <label>
            <span>{isTopic ? 'Description' : 'Message'}</span>
            <textarea
              maxLength={24_000}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={isTopic ? 5 : 12}
              value={body}
            />
            <small>Plain text with safe clickable HTTP and qdn:// links.</small>
          </label>
          {isTopic && (
            <label>
              <span>Tags</span>
              <input
                onChange={(event) => setTags(event.target.value)}
                placeholder="development, releases, questions"
                value={tags}
              />
              <small>Up to five comma-separated tags.</small>
            </label>
          )}
          {composer.kind === 'thread' && (
            <>
              {canAttach ? (
                <div className="form-section">
                  <div>
                    <strong>Attachments</strong>
                    <small>Selected files publish and confirm before this thread can reference them.</small>
                  </div>
                  <button className="button button--secondary" disabled={busy} onClick={addAttachment} type="button">
                    Add file
                  </button>
                </div>
              ) : null}
              <AttachmentList attachments={attachments} />
              {canCreatePoll ? (
                <label className="toggle-row">
                  <input
                    checked={pollEnabled}
                    disabled={Boolean(confirmedPollName)}
                    onChange={(event) => setPollEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>Add a native poll</strong>
                    <small>
                      {confirmedPollName
                        ? 'Poll confirmed. Retry will publish only the thread record.'
                        : 'Votes are public, signed Core transactions.'}
                    </small>
                  </span>
                </label>
              ) : null}
              {canCreatePoll && pollEnabled && (
                <div className="poll-builder">
                  {pollOptions.map((option, index) => (
                    <label key={index}>
                      <span>Option {index + 1}</span>
                      <input
                        disabled={Boolean(confirmedPollName)}
                        onChange={(event) =>
                          setPollOptions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          )
                        }
                        required
                        value={option}
                      />
                    </label>
                  ))}
                  <button
                    className="button button--quiet"
                    disabled={Boolean(confirmedPollName)}
                    onClick={() => setPollOptions((current) => [...current, ''])}
                    type="button"
                  >
                    Add option
                  </button>
                  <label>
                    <span>Optional closing time</span>
                    <input
                      disabled={Boolean(confirmedPollName)}
                      min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                      onChange={(event) => setPollEnd(event.target.value)}
                      type="datetime-local"
                      value={pollEnd}
                    />
                  </label>
                </div>
              )}
            </>
          )}
          {message ? <Notice tone={messageTone}>{message}</Notice> : null}
          <footer className="modal__footer">
            <span>Publishing as <strong>{name}</strong></span>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? 'Awaiting confirmation…' : editEntity ? 'Publish edit' : 'Publish'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function TipModal({
  composer,
  name,
  onClose,
  onPublished,
}: {
  composer: Extract<Exclude<Composer, null>, { kind: 'tip' }>;
  name: string;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('1');
  const [confirmedPayment, setConfirmedPayment] = useState<TipRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'danger' | 'info' | 'success'>('info');

  function setStatus(nextMessage: string) {
    setMessageTone('info');
    setMessage(nextMessage);
  }

  function closeTip() {
    if (
      confirmedPayment &&
      !window.confirm(
        'The QORT payment is confirmed, but its public Boards receipt is not. Close without publishing the receipt?',
      )
    ) {
      return;
    }

    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus('Resolving recipient…');
    let paymentIsConfirmed = Boolean(confirmedPayment);

    try {
      const recipientAddress = composer.target.ownerAddress;

      if (!recipientAddress) {
        throw new Error(`Could not resolve the owner address for ${composer.target.ownerName}.`);
      }

      let receiptRecord = confirmedPayment;

      if (!receiptRecord) {
        setStatus('Waiting for Home approval to send the QORT payment…');
        const payment = await sendTipPayment({
          amount,
          name,
          recipientAddress,
          recipientName: composer.target.ownerName,
          targetId: composer.target.id,
          targetKind: composer.targetKind,
        });
        const paymentTarget =
          payment.paymentConfirmationTarget ??
          transactionConfirmationTarget(payment.paymentResult);

        if (!paymentTarget) {
          throw new Error('Payment was submitted, but Home did not return a transaction signature.');
        }

        setStatus('Payment submitted. Awaiting network confirmation…');
        await requireConfirmation(paymentTarget, 'Tip payment');
        receiptRecord = payment.record;
        paymentIsConfirmed = true;
        setConfirmedPayment(receiptRecord);
      }

      setStatus('Payment confirmed. Publishing the public tip receipt…');
      const receipt = await publishTipReceipt(name, receiptRecord);
      await confirmQdnPublication(
        receipt.publishResult,
        receipt.publishConfirmationTarget,
        'Tip receipt',
        setStatus,
      );
      setMessageTone('success');
      setMessage('Payment and tip receipt confirmed.');
      await onPublished();
    } catch (error) {
      setMessageTone('danger');
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(
        paymentIsConfirmed
          ? `The QORT payment is already confirmed; retry will publish only its receipt. ${detail}`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="tip-title" aria-modal="true" className="modal modal--small" role="dialog">
        <header className="modal__header">
          <div>
            <span className="eyebrow">Verified receipt</span>
            <h2 id="tip-title">Tip {composer.target.ownerName}</h2>
          </div>
          <button className="button button--quiet" onClick={closeTip} type="button">
            Close
          </button>
        </header>
        <form className="composer-form" onSubmit={submit}>
          <label>
            <span>QORT amount</span>
            <input
              min="0.00000001"
              disabled={Boolean(confirmedPayment)}
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.00000001"
              type="number"
              value={amount}
            />
          </label>
          <Notice>
            Home will show the recipient and amount before signing. Boards stores the returned
            transaction signature instead of a mutable tip counter.
          </Notice>
          {message ? <Notice tone={messageTone}>{message}</Notice> : null}
          <footer className="modal__footer">
            <span>Receipt publisher: <strong>{name}</strong></span>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? 'Awaiting confirmation…' : confirmedPayment ? 'Publish receipt' : 'Review and send'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<QdnDisplaySettings>(getInitialDisplaySettings);
  const [route, setRoute] = useState<Route>(readRoute);
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [accountContext, setAccountContext] = useState<AccountContext>({
    account: null,
    writableNames: [],
  });
  const [selectedName, setSelectedName] = useState('');
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [composer, setComposer] = useState<Composer>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyAttachments, setReplyAttachments] = useState<AttachmentReference[]>([]);
  const [copiedPostId, setCopiedPostId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(route.kind === 'board' ? route.search : '');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const deepLinkRef = useRef<HTMLDivElement | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  const canPublish =
    Boolean(selectedName) &&
    Boolean(bridge?.isHomeBridge) &&
    hasAction(bridge?.actions ?? [], 'PUBLISH_QDN_RESOURCE');
  const canCreatePoll =
    canPublish &&
    hasAction(bridge?.actions ?? [], 'CREATE_POLL');
  const canVote =
    canPublish &&
    hasAction(bridge?.actions ?? [], 'VOTE_ON_POLL');
  const canAttach =
    canPublish &&
    hasAction(bridge?.actions ?? [], 'SELECT_QDN_PUBLISH_SOURCE') &&
    hasAction(bridge?.actions ?? [], 'PUBLISH_QDN_RESOURCE');
  const canTip =
    canPublish &&
    !bridge?.isUsingPublicNode &&
    hasAction(bridge?.actions ?? [], 'SEND_COIN');
  const currentAddress = accountContext.account?.address ?? '';
  const isStaff =
    board.admins.includes(currentAddress) ||
    board.moderators.includes(currentAddress);

  function navigate(next: Route, intent: NavigationIntent = 'standard') {
    if (typeof window !== 'undefined') {
      window.history[shouldReplaceHistory(intent) ? 'replaceState' : 'pushState'](
        {},
        '',
        routeUrl(next),
      );
    }
    setRoute(next);
    setComposer(null);
    window.scrollTo({ top: 0 });
  }

  async function refreshBoard(quiet = false) {
    if (!quiet) setLoading(true);
    setError('');
    try {
      setBoard(await loadBoard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function loadContext() {
    setLoading(true);
    setError('');
    try {
      const [nextBridge, status] = await Promise.all([
        getBridgeState(),
        qdnRequest<NodeStatus>({ action: 'GET_NODE_STATUS' }),
      ]);
      setBridge(nextBridge);
      setNodeStatus(status);

      if (nextBridge.isHomeBridge && hasAction(nextBridge.actions, 'GET_SELECTED_ACCOUNT')) {
        try {
          const context = await loadAccountContext();
          setAccountContext(context);
          setSelectedName((current) =>
            current && context.writableNames.includes(current)
              ? current
              : context.writableNames[0] ?? '',
          );
        } catch (accountError) {
          setMessage(
            accountError instanceof Error ? accountError.message : String(accountError),
          );
        }
      }

      await refreshBoard(true);
    } catch (contextError) {
      setError(contextError instanceof Error ? contextError.message : String(contextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    applyDisplaySettings(settings);
  }, [settings]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const next = getDisplaySettingsUpdateFromMessage(event.data, settings);
      if (next) setSettings(next);
    };
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('message', onMessage);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('popstate', onPopState);
    };
  }, [settings]);

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    },
    [],
  );

  const visibleTopics = useMemo(
    () => board.topics.filter((topic) => !topic.deleted && (!topic.hidden || isStaff)),
    [board.topics, isStaff],
  );
  const visibleThreads = useMemo(
    () => board.threads.filter((thread) => !thread.deleted && (!thread.hidden || isStaff)),
    [board.threads, isStaff],
  );
  const visiblePosts = useMemo(
    () => board.posts.filter((post) => !post.deleted && (!post.hidden || isStaff)),
    [board.posts, isStaff],
  );

  const currentTopic =
    route.kind === 'topic'
      ? visibleTopics.find((topic) => topic.id === route.topicId) ?? null
      : route.kind === 'thread'
        ? (() => {
            const thread = visibleThreads.find((item) => item.id === route.threadId);
            return visibleTopics.find((topic) => topic.id === thread?.topicId) ?? null;
          })()
        : null;
  const currentThread =
    route.kind === 'thread'
      ? visibleThreads.find((thread) => thread.id === route.threadId) ?? null
      : null;
  const postTarget = resolvePostTarget(route, visiblePosts);

  useEffect(() => {
    if (loading || postTarget.kind !== 'found') return;

    const frame = window.requestAnimationFrame(() => {
      deepLinkRef.current?.scrollIntoView({ block: 'center' });
      deepLinkRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, postTarget.kind, postTarget.kind === 'found' ? postTarget.post.id : null]);

  async function publishAndRefresh(nextRoute?: Route) {
    setMessage('Publication confirmed. Refreshing QDN records…');
    setComposer(null);
    await refreshBoard(true);
    if (nextRoute) navigate(nextRoute);
    setMessage('Published and confirmed.');
  }

  async function handleReaction(
    targetKind: 'post' | 'thread',
    targetId: string,
    reaction: ReactionValue | null,
  ) {
    if (!canPublish) return;
    setWorking(true);
    setError('');
    try {
      const record = createReaction(targetKind, targetId, reaction);
      await publishConfirmedRecord(selectedName, record, 'Reaction publication', setMessage);
      await refreshBoard(true);
      setMessage(reaction ? 'Reaction confirmed.' : 'Reaction removal confirmed.');
    } catch (reactionError) {
      setError(reactionError instanceof Error ? reactionError.message : String(reactionError));
    } finally {
      setWorking(false);
    }
  }

  async function handleDelete(target: ReducedPost | ReducedThread | ReducedTopic) {
    if (!window.confirm('Publish a tombstone for this record? This cannot remove already public QDN history.')) {
      return;
    }
    setWorking(true);
    setError('');
    try {
      const tombstone = createEdit({
        deleted: true,
        targetId: target.id,
        targetKind: target.kind,
      });
      await publishConfirmedRecord(
        selectedName,
        tombstone,
        'Deletion tombstone',
        setMessage,
      );
      await refreshBoard(true);
      if (target.kind !== 'post') navigate({ kind: 'board', search: '' });
      setMessage('Deletion tombstone confirmed.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setWorking(false);
    }
  }

  async function handleModeration(
    target: ReducedPost | ReducedThread | ReducedTopic,
    action: Parameters<typeof createModeration>[2],
  ) {
    setWorking(true);
    setError('');
    try {
      const record = createModeration(target.kind, target.id, action);
      await publishConfirmedRecord(selectedName, record, 'Moderation update', setMessage);
      await refreshBoard(true);
      setMessage('Moderation update confirmed.');
    } catch (moderationError) {
      setError(
        moderationError instanceof Error ? moderationError.message : String(moderationError),
      );
    } finally {
      setWorking(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!currentThread || !replyBody.trim()) return;
    setWorking(true);
    setError('');
    try {
      const post = createPost({
        attachments: replyAttachments,
        body: replyBody,
        replyToId,
        threadId: currentThread.id,
      });
      await publishConfirmedRecord(selectedName, post, 'Reply publication', setMessage);
      setReplyBody('');
      setReplyToId(null);
      setReplyAttachments([]);
      await refreshBoard(true);
      navigate(
        { kind: 'thread', postId: post.id, threadId: currentThread.id },
        'published-reply',
      );
      setMessage('Reply published and confirmed.');
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : String(replyError));
    } finally {
      setWorking(false);
    }
  }

  async function addReplyAttachment() {
    if (!canAttach) return;
    setWorking(true);
    setError('');
    try {
      setMessage('Select a file to publish through Qortium Home…');
      const published = await selectAndPublishAttachmentWithResult(selectedName);
      if (published) {
        await confirmQdnPublication(
          published.publishResult,
          published.confirmationTarget,
          'Attachment publication',
          setMessage,
        );
        setReplyAttachments((current) => [...current, published.attachment]);
        setMessage('Attachment confirmed and ready to include.');
      } else {
        setMessage('');
      }
    } catch (attachmentError) {
      setError(
        attachmentError instanceof Error ? attachmentError.message : String(attachmentError),
      );
    } finally {
      setWorking(false);
    }
  }

  async function share(routeToShare: Route, postId?: string) {
    const copied = await copyTextToClipboard(buildRouteLink(routeToShare));

    if (copied && postId) {
      setCopiedPostId(postId);
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopiedPostId((current) => (current === postId ? null : current));
        copyFeedbackTimerRef.current = null;
      }, 2_000);
      return;
    }

    setMessage(copied ? 'QDN deep link copied.' : 'Copy is unavailable in this view.');
  }

  const search = route.kind === 'board' ? route.search.toLowerCase() : '';
  const searchResults = search
    ? {
        posts: visiblePosts.filter((post) => post.body.toLowerCase().includes(search)),
        threads: visibleThreads.filter(
          (thread) =>
            thread.title.toLowerCase().includes(search) ||
            thread.body.toLowerCase().includes(search),
        ),
        topics: visibleTopics.filter(
          (topic) =>
            topic.title.toLowerCase().includes(search) ||
            topic.description.toLowerCase().includes(search) ||
            topic.tags.some((tag) => tag.toLowerCase().includes(search)),
        ),
      }
    : null;

  return (
    <div className="app">
      <a className="skip-link" href="#boards-main">
        Skip to Boards content
      </a>
      <header className="app-topbar">
        <button
          aria-label="Open Boards home"
          className="brand"
          onClick={() => navigate({ kind: 'board', search: '' })}
          type="button"
        >
          <span className="brand__mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong>Boards</strong>
            <small>Qortium discussions</small>
          </span>
        </button>
        <form
          className="global-search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ kind: 'board', search: searchInput.trim() });
          }}
        >
          <label className="sr-only" htmlFor="global-search">
            Search topics, threads and posts
          </label>
          <input
            id="global-search"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search Boards"
            type="search"
            value={searchInput}
          />
          <button className="button button--secondary" type="submit">
            Search
          </button>
        </form>
        <div className="topbar-actions">
          {canPublish ? (
            <button className="button button--primary" onClick={() => setComposer({ kind: 'topic' })} type="button">
              New topic
            </button>
          ) : null}
          <button
            aria-label={`Refresh account context for ${selectedName || 'read-only browsing'}`}
            className="account-button"
            onClick={() => void loadContext()}
            type="button"
          >
            <Avatar name={selectedName || accountContext.account?.address || 'Guest'} />
            <span>
              <strong>{selectedName || 'Read only'}</strong>
              <small>{bridge?.isHomeBridge ? bridge.ui : 'Browser development'}</small>
            </span>
          </button>
        </div>
      </header>
      <nav aria-label="Boards workspaces" className="app-tabs">
        <button
          aria-current={route.kind === 'developers' ? undefined : 'page'}
          className={`app-tab${route.kind === 'developers' ? '' : ' is-active'}`}
          onClick={() => navigate({ kind: 'board', search: '' })}
          type="button"
        >
          Browse
        </button>
        <button
          aria-current={route.kind === 'developers' ? 'page' : undefined}
          className={`app-tab${route.kind === 'developers' ? ' is-active' : ''}`}
          onClick={() => navigate({ kind: 'developers' })}
          type="button"
        >
          Developers
        </button>
      </nav>

      <main className="app-main" id="boards-main">
        <div className="route-announcer" aria-live="polite">
          {route.kind === 'board'
            ? search
              ? `Search results for ${route.search}`
              : 'Boards home'
            : route.kind === 'developers'
              ? 'Boards developer reference'
            : route.kind === 'topic'
              ? currentTopic?.title ?? 'Topic not found'
              : currentThread?.title ?? 'Thread not found'}
        </div>

        <div className="context-strip">
          <span className={`connection-dot${nodeStatus?.syncPercent === 100 ? ' is-ready' : ''}`} />
          <span>
            {nodeStatus?.syncPercent === 100
              ? `Node synced at ${nodeStatus.height?.toLocaleString() ?? 'unknown height'}`
              : 'Node status unavailable'}
          </span>
          <span>·</span>
          <span>{bridge?.isUsingPublicNode ? 'Public-node writes use Home approval' : 'Active node context'}</span>
          {accountContext.writableNames.length > 1 ? (
            <label className="name-picker">
              <span>Publish as</span>
              <select onChange={(event) => setSelectedName(event.target.value)} value={selectedName}>
                {accountContext.writableNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="link-button" onClick={() => void refreshBoard()} type="button">
            Refresh
          </button>
        </div>

        {loading ? <Notice>Loading QDN discussions…</Notice> : null}
        {message ? <Notice>{message}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!bridge?.isHomeBridge && !loading ? (
          <Notice tone="warning">
            Browser development is read-only. Open Boards inside Qortium Home to publish,
            vote, react, attach files or tip.
          </Notice>
        ) : null}
        {bridge?.isHomeBridge && !selectedName && !loading ? (
          <Notice tone="warning">
            Publishing requires an unlocked account with a registered QDN name.
          </Notice>
        ) : null}

        {route.kind === 'developers' ? <Reference /> : null}

        {route.kind === 'board' && (
          <>
            <section className="hero board-overview">
              <div>
                <span className="eyebrow">Public QDN discussions</span>
                <h1>Community discussions</h1>
                <p>
                  Browse topics and threads whose authorship, edits, reactions, moderation,
                  polls, and tip receipts can be checked against confirmed transactions.
                </p>
              </div>
              <div className="hero__stats">
                <span><strong>{visibleTopics.length}</strong> topics</span>
                <span><strong>{visibleThreads.length}</strong> threads</span>
                <span><strong>{visiblePosts.length}</strong> replies</span>
              </div>
            </section>

            {searchResults ? (
              <section className="content-panel">
                <header className="section-heading">
                  <div>
                    <span className="eyebrow">Search</span>
                    <h2>Results for “{route.search}”</h2>
                  </div>
                  <button className="button button--quiet" onClick={() => navigate({ kind: 'board', search: '' })} type="button">
                    Clear
                  </button>
                </header>
                <div className="search-groups">
                  <ResultGroup
                    empty="No matching topics."
                    items={searchResults.topics}
                    label="Topics"
                    onOpen={(item) => navigate({ kind: 'topic', topicId: item.id })}
                  />
                  <ResultGroup
                    empty="No matching threads."
                    items={searchResults.threads}
                    label="Threads"
                    onOpen={(item) => navigate({ kind: 'thread', threadId: item.id })}
                  />
                  <ResultGroup
                    empty="No matching replies."
                    items={searchResults.posts}
                    label="Replies"
                    onOpen={(item) =>
                      navigate({ kind: 'thread', postId: item.id, threadId: item.threadId })
                    }
                  />
                </div>
              </section>
            ) : (
              <div className="board-layout">
                <aside className="board-aside">
                  <div className="aside-card">
                    <span className="eyebrow">About Boards</span>
                    <h2>Open by design</h2>
                    <p>
                      Every discussion is public QDN data. “Restricted access” is not
                      presented as private or encrypted storage.
                    </p>
                  </div>
                  <div className="aside-card">
                    <span className="eyebrow">State model</span>
                    <ul>
                      <li>Authors control their content.</li>
                      <li>Reactions cannot overwrite posts.</li>
                      <li>Native polls use Core transactions.</li>
                      <li>Tips retain transaction signatures.</li>
                    </ul>
                  </div>
                </aside>
                <section className="topic-collection">
                  <header className="section-heading">
                    <div>
                      <span className="eyebrow">Browse</span>
                      <h2>Topics</h2>
                    </div>
                    {canPublish ? (
                      <button className="button button--primary" onClick={() => setComposer({ kind: 'topic' })} type="button">
                        Create topic
                      </button>
                    ) : null}
                  </header>
                  <div className="topic-grid">
                    {visibleTopics.map((topic) => {
                      const threads = visibleThreads.filter((thread) => thread.topicId === topic.id);
                      const replies = visiblePosts.filter((post) =>
                        threads.some((thread) => thread.id === post.threadId),
                      );
                      return (
                        <button
                          className="topic-card"
                          key={topic.id}
                          onClick={() => navigate({ kind: 'topic', topicId: topic.id })}
                          type="button"
                        >
                          <span className="topic-card__mark">{initials(topic.title)}</span>
                          <span className="topic-card__body">
                            <span className="topic-card__title">{topic.title}</span>
                            <span>{topic.description || 'Open this topic to start a discussion.'}</span>
                            <span className="tag-row">
                              {topic.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                            </span>
                          </span>
                          <span className="topic-card__meta">
                            <span>{threads.length} threads</span>
                            <span>{replies.length} replies</span>
                            <span>by {topic.ownerName}</span>
                          </span>
                        </button>
                      );
                    })}
                    {!visibleTopics.length ? (
                      <div className="empty-state">
                        <span className="empty-state__mark">B</span>
                        <h3>No topics yet</h3>
                        <p>
                          {canPublish
                            ? 'Create the first public discussion area.'
                            : 'Open Boards in Qortium Home with a registered name to create the first topic.'}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {route.kind === 'topic' && (
          currentTopic ? (
            <section>
              <Breadcrumbs
                items={[
                  { label: 'Boards', onClick: () => navigate({ kind: 'board', search: '' }) },
                  { label: currentTopic.title },
                ]}
              />
              <header className="entity-header">
                <div>
                  <span className="eyebrow">Topic · {currentTopic.ownerName}</span>
                  <h1>{currentTopic.title}</h1>
                  <p>{currentTopic.description}</p>
                  <div className="tag-row">
                    {currentTopic.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                </div>
                <div className="entity-actions">
                  <button className="button button--quiet" onClick={() => void share(route)} type="button">
                    Copy topic link
                  </button>
                  {currentTopic.ownerAddress === currentAddress ? (
                    <>
                      <button className="button button--secondary" onClick={() => setComposer({ kind: 'edit-topic', topic: currentTopic })} type="button">
                        Edit
                      </button>
                      <button className="button button--danger" disabled={working} onClick={() => void handleDelete(currentTopic)} type="button">
                        Delete
                      </button>
                    </>
                  ) : null}
                  {canPublish ? (
                    <button className="button button--primary" onClick={() => setComposer({ kind: 'thread', topicId: currentTopic.id })} type="button">
                      New thread
                    </button>
                  ) : null}
                </div>
              </header>
              <div className="thread-layout">
                <section className="content-panel">
                  <header className="section-heading">
                    <div>
                      <span className="eyebrow">Conversations</span>
                      <h2>Threads</h2>
                    </div>
                    <span className="status-chip">
                      {visibleThreads.filter((thread) => thread.topicId === currentTopic.id).length}
                    </span>
                  </header>
                  <div className="thread-list">
                    {visibleThreads
                      .filter((thread) => thread.topicId === currentTopic.id)
                      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.resourceUpdated - a.resourceUpdated)
                      .map((thread) => {
                        const replies = visiblePosts.filter((post) => post.threadId === thread.id);
                        return (
                          <button
                            className="thread-row"
                            key={thread.id}
                            onClick={() => navigate({ kind: 'thread', threadId: thread.id })}
                            type="button"
                          >
                            <Avatar name={thread.ownerName} />
                            <span className="thread-row__body">
                              <span className="thread-row__title">
                                {thread.pinned ? <span className="status-chip">Pinned</span> : null}
                                {thread.solved ? <span className="status-chip status-chip--success">Solved</span> : null}
                                {thread.locked ? <span className="status-chip">Locked</span> : null}
                                {thread.poll ? <span className="status-chip">Poll</span> : null}
                                <strong>{thread.title}</strong>
                              </span>
                              <span>{thread.body.slice(0, 180)}</span>
                              <small>
                                by {thread.ownerName} · {formatDate(thread.resourceUpdated)}
                              </small>
                            </span>
                            <span className="thread-row__stats">
                              <strong>{replies.length}</strong>
                              <small>replies</small>
                            </span>
                          </button>
                        );
                      })}
                    {!visibleThreads.some((thread) => thread.topicId === currentTopic.id) ? (
                      <div className="empty-state">
                        <h3>No threads yet</h3>
                        <p>Start the first conversation in this topic.</p>
                      </div>
                    ) : null}
                  </div>
                </section>
                <aside className="board-aside">
                  <div className="aside-card">
                    <span className="eyebrow">Guideline</span>
                    <h3>Keep outcomes discoverable</h3>
                    <p>Use a clear title, summarize decisions, and link concrete work back to Qortium Help or GitHub.</p>
                  </div>
                  {isStaff ? (
                    <div className="aside-card">
                      <span className="eyebrow">Moderation</span>
                      <button className="button button--secondary" onClick={() => void handleModeration(currentTopic, currentTopic.hidden ? 'show' : 'hide')} type="button">
                        {currentTopic.hidden ? 'Show topic' : 'Hide topic'}
                      </button>
                    </div>
                  ) : null}
                </aside>
              </div>
            </section>
          ) : <NotFound onHome={() => navigate({ kind: 'board', search: '' })} />
        )}

        {route.kind === 'thread' && (
          currentThread && currentTopic ? (
            <section>
              <Breadcrumbs
                items={[
                  { label: 'Boards', onClick: () => navigate({ kind: 'board', search: '' }) },
                  { label: currentTopic.title, onClick: () => navigate({ kind: 'topic', topicId: currentTopic.id }) },
                  { label: currentThread.title },
                ]}
              />
              <header className="entity-header entity-header--thread">
                <div>
                  <div className="status-row">
                    {currentThread.pinned ? <span className="status-chip">Pinned</span> : null}
                    {currentThread.solved ? <span className="status-chip status-chip--success">Solved</span> : null}
                    {currentThread.locked ? <span className="status-chip">Locked</span> : null}
                    {currentThread.poll ? <span className="status-chip">Native poll</span> : null}
                  </div>
                  <h1>{currentThread.title}</h1>
                  <p>Started by {currentThread.ownerName} · {formatDate(currentThread.resourceCreated)}</p>
                </div>
                <div className="entity-actions">
                  <button
                    className="button button--quiet"
                    onClick={() =>
                      void share({ kind: 'thread', threadId: currentThread.id })
                    }
                    type="button"
                  >
                    Copy thread link
                  </button>
                  {currentThread.ownerAddress === currentAddress ? (
                    <>
                      <button className="button button--secondary" onClick={() => setComposer({ kind: 'edit-thread', thread: currentThread })} type="button">Edit</button>
                      <button className="button button--danger" onClick={() => void handleDelete(currentThread)} type="button">Delete</button>
                    </>
                  ) : null}
                </div>
              </header>

              <div className="thread-layout">
                <div className="post-stack">
                  <article className="post-card post-card--lead">
                    <header className="post-card__header">
                      <Avatar name={currentThread.ownerName} />
                      <div>
                        <strong>{currentThread.ownerName}</strong>
                        <small>{formatDate(currentThread.resourceUpdated)}</small>
                      </div>
                    </header>
                    <RichBody body={currentThread.body} />
                    <AttachmentList attachments={currentThread.attachments} />
                    {currentThread.poll ? (
                      <PollCard canVote={canVote} pollName={currentThread.poll.pollName} />
                    ) : null}
                    <footer className="post-card__footer">
                      <ReactionBar
                        counts={currentThread.reactionCounts}
                        currentName={selectedName}
                        currentReaction={currentThread.reactionsByAddress[currentAddress]}
                        disabled={!canPublish || working}
                        onReact={(reaction) => void handleReaction('thread', currentThread.id, reaction)}
                      />
                      <div className="post-actions">
                        {canTip ? (
                          <button className="link-button" onClick={() => setComposer({ kind: 'tip', target: currentThread, targetKind: 'thread' })} type="button">
                            Tip{currentThread.tipCount ? ` · ${currentThread.tipTotal.toFixed(2)} QORT` : ''}
                          </button>
                        ) : null}
                        {isStaff ? (
                          <>
                            <button className="link-button" onClick={() => void handleModeration(currentThread, currentThread.pinned ? 'unpin' : 'pin')} type="button">
                              {currentThread.pinned ? 'Unpin' : 'Pin'}
                            </button>
                            <button className="link-button" onClick={() => void handleModeration(currentThread, currentThread.locked ? 'unlock' : 'lock')} type="button">
                              {currentThread.locked ? 'Unlock' : 'Lock'}
                            </button>
                            <button className="link-button" onClick={() => void handleModeration(currentThread, currentThread.solved ? 'unsolve' : 'solve')} type="button">
                              {currentThread.solved ? 'Reopen' : 'Solve'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </footer>
                  </article>

                  <section aria-labelledby="replies-heading">
                    <header className="reply-heading">
                      <div>
                        <span className="eyebrow">Conversation</span>
                        <h2 id="replies-heading">
                          {visiblePosts.filter((post) => post.threadId === currentThread.id).length} replies
                        </h2>
                      </div>
                    </header>
                    {postTarget.kind === 'missing' ? (
                      <Notice tone="warning">
                        <span>
                          This linked reply is unavailable, deleted, hidden, or belongs to a
                          different thread. The rest of the conversation is still available.
                        </span>{' '}
                        <button
                          className="link-button"
                          onClick={() =>
                            navigate(
                              { kind: 'thread', threadId: currentThread.id },
                              'clear-target',
                            )
                          }
                          type="button"
                        >
                          Show whole thread
                        </button>
                      </Notice>
                    ) : null}
                    <ol className="reply-list">
                      {visiblePosts
                        .filter((post) => post.threadId === currentThread.id)
                        .sort((a, b) => a.resourceCreated - b.resourceCreated)
                        .map((post) => {
                          const repliedTo = post.replyToId
                            ? visiblePosts.find((item) => item.id === post.replyToId)
                            : null;
                          return (
                            <li key={post.id}>
                              <article
                                className={`post-card${postTarget.kind === 'found' && postTarget.post.id === post.id ? ' is-targeted' : ''}`}
                                id={`post-${post.id}`}
                                ref={postTarget.kind === 'found' && postTarget.post.id === post.id ? deepLinkRef : undefined}
                                tabIndex={postTarget.kind === 'found' && postTarget.post.id === post.id ? -1 : undefined}
                              >
                                <header className="post-card__header">
                                  <Avatar name={post.ownerName} />
                                  <div>
                                    <strong>{post.ownerName}</strong>
                                    <small>{formatDate(post.resourceUpdated)}</small>
                                  </div>
                                  <span className="post-number">#{post.id.slice(-5)}</span>
                                </header>
                                {repliedTo ? (
                                  <button
                                    className="reply-reference"
                                    onClick={() =>
                                      navigate({
                                        kind: 'thread',
                                        postId: repliedTo.id,
                                        threadId: currentThread.id,
                                      })
                                    }
                                    type="button"
                                  >
                                    In reply to {repliedTo.ownerName}: “{repliedTo.body.slice(0, 110)}”
                                  </button>
                                ) : null}
                                <RichBody body={post.body} />
                                <AttachmentList attachments={post.attachments} />
                                <footer className="post-card__footer">
                                  <ReactionBar
                                    counts={post.reactionCounts}
                                    currentName={selectedName}
                                    currentReaction={post.reactionsByAddress[currentAddress]}
                                    disabled={!canPublish || working}
                                    onReact={(reaction) => void handleReaction('post', post.id, reaction)}
                                  />
                                  <div className="post-actions">
                                    <button
                                      className="link-button"
                                      onClick={() =>
                                        void share(
                                          {
                                            kind: 'thread',
                                            postId: post.id,
                                            threadId: currentThread.id,
                                          },
                                          post.id,
                                        )
                                      }
                                      type="button"
                                    >
                                      {copiedPostId === post.id ? 'Copied' : 'Copy link'}
                                    </button>
                                    {canPublish && !currentThread.locked ? (
                                      <button className="link-button" onClick={() => setReplyToId(post.id)} type="button">
                                        Reply
                                      </button>
                                    ) : null}
                                    {post.ownerAddress === currentAddress ? (
                                      <>
                                        <button className="link-button" onClick={() => setComposer({ kind: 'edit-post', post })} type="button">Edit</button>
                                        <button className="link-button danger-text" onClick={() => void handleDelete(post)} type="button">Delete</button>
                                      </>
                                    ) : null}
                                    {canTip ? (
                                      <button className="link-button" onClick={() => setComposer({ kind: 'tip', target: post, targetKind: 'post' })} type="button">
                                        Tip{post.tipCount ? ` · ${post.tipTotal.toFixed(2)} QORT` : ''}
                                      </button>
                                    ) : null}
                                    {isStaff ? (
                                      <button className="link-button" onClick={() => void handleModeration(post, post.hidden ? 'show' : 'hide')} type="button">
                                        {post.hidden ? 'Show' : 'Hide'}
                                      </button>
                                    ) : null}
                                  </div>
                                </footer>
                              </article>
                            </li>
                          );
                        })}
                    </ol>
                  </section>

                  {canPublish && !currentThread.locked ? (
                    <form className="reply-composer" onSubmit={submitReply}>
                      <header>
                        <div>
                          <span className="eyebrow">Publish as {selectedName}</span>
                          <h2>{replyToId ? 'Write a reply' : 'Join the discussion'}</h2>
                        </div>
                        {replyToId ? (
                          <button className="button button--quiet" onClick={() => setReplyToId(null)} type="button">
                            Cancel reply reference
                          </button>
                        ) : null}
                      </header>
                      <textarea
                        maxLength={24_000}
                        onChange={(event) => setReplyBody(event.target.value)}
                        placeholder="Write a thoughtful public reply…"
                        required
                        rows={8}
                        value={replyBody}
                      />
                      <AttachmentList attachments={replyAttachments} />
                      <footer>
                        <span>Public QDN JSON · safe link rendering</span>
                        <div>
                          {canAttach ? (
                            <button className="button button--secondary" disabled={working} onClick={addReplyAttachment} type="button">
                              Add file
                            </button>
                          ) : null}
                          <button className="button button--primary" disabled={working || !replyBody.trim()} type="submit">
                            {working ? 'Publishing…' : 'Publish reply'}
                          </button>
                        </div>
                      </footer>
                    </form>
                  ) : currentThread.locked ? (
                    <Notice tone="warning">This thread is locked. Existing content remains readable.</Notice>
                  ) : null}
                </div>
                <aside className="board-aside thread-info">
                  <div className="aside-card">
                    <span className="eyebrow">Thread details</span>
                    <dl>
                      <div><dt>Author</dt><dd>{currentThread.ownerName}</dd></div>
                      <div><dt>Replies</dt><dd>{visiblePosts.filter((post) => post.threadId === currentThread.id).length}</dd></div>
                      <div><dt>Attachments</dt><dd>{currentThread.attachments.length}</dd></div>
                      <div><dt>Tip receipts</dt><dd>{currentThread.tipCount}</dd></div>
                    </dl>
                  </div>
                  <div className="aside-card">
                    <span className="eyebrow">Public data notice</span>
                    <p>Posts are public and not encrypted. Deletion publishes a tombstone; it cannot erase QDN history.</p>
                  </div>
                </aside>
              </div>
            </section>
          ) : <NotFound onHome={() => navigate({ kind: 'board', search: '' })} />
        )}
      </main>

      {composer && composer.kind !== 'tip' ? (
        <ComposerModal
          canAttach={canAttach}
          canCreatePoll={canCreatePoll}
          composer={composer}
          name={selectedName}
          onClose={() => setComposer(null)}
          onPublished={publishAndRefresh}
        />
      ) : null}
      {composer?.kind === 'tip' ? (
        <TipModal
          composer={composer}
          name={selectedName}
          onClose={() => setComposer(null)}
          onPublished={async () => {
            setComposer(null);
            await refreshBoard(true);
            setMessage('Tip payment and receipt confirmed.');
          }}
        />
      ) : null}
    </div>
  );
}

function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index ? <span aria-hidden="true">/</span> : null}
          {item.onClick ? (
            <button onClick={item.onClick} type="button">{item.label}</button>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function ResultGroup<T extends ReducedPost | ReducedThread | ReducedTopic>({
  empty,
  items,
  label,
  onOpen,
}: {
  empty: string;
  items: T[];
  label: string;
  onOpen: (item: T) => void;
}) {
  return (
    <section>
      <h3>{label} <span>{items.length}</span></h3>
      <div className="result-list">
        {items.map((item) => (
          <button key={item.id} onClick={() => onOpen(item)} type="button">
            <strong>{'title' in item ? item.title : item.body.slice(0, 80)}</strong>
            <span>{item.ownerName} · {formatDate(item.resourceUpdated)}</span>
          </button>
        ))}
        {!items.length ? <p>{empty}</p> : null}
      </div>
    </section>
  );
}

function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <div className="empty-state empty-state--page">
      <span className="empty-state__mark">?</span>
      <h1>Discussion not found</h1>
      <p>The record may still be propagating, hidden, deleted, or unavailable from this node.</p>
      <button className="button button--primary" onClick={onHome} type="button">Back to Boards</button>
    </div>
  );
}
