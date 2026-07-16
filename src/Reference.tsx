import { useState } from 'react';
import {
  BOARD_FILE_NAME,
  BOARD_ROOT_NAME,
  BOARD_SCHEMA,
  BOARD_SERVICE,
  IDENTIFIERS,
  REACTION_VALUES,
} from './boardModel';
import { copyTextToClipboard } from './clipboard';

const IDENTIFIER_ROWS = [
  ['Configuration', IDENTIFIERS.config, 'One logical configuration resource per publisher name. Only a record from the root authority address is accepted.'],
  ['Topic', `${IDENTIFIERS.topic}{id}`, 'Creates a topic. The first confirmed create for an id wins.'],
  ['Thread', `${IDENTIFIERS.thread}{id}`, 'Creates a thread within a topic.'],
  ['Post', `${IDENTIFIERS.post}{id}`, 'Creates a reply within a thread.'],
  ['Edit', `${IDENTIFIERS.edit}{id}`, 'Adds an author patch or deletion tombstone for a topic, thread or post.'],
  ['Reaction', `${IDENTIFIERS.reaction}{targetId}`, 'A publisher name updates one resource tuple per target; reduction then keeps the latest confirmed reaction per creator address.'],
  ['Moderation', `${IDENTIFIERS.moderation}{id}`, 'Adds a staff action such as hide, lock, pin or solve.'],
  ['Tip receipt', `${IDENTIFIERS.tip}{id}`, 'Links a confirmed PAYMENT transaction to a thread or post.'],
  ['Attachment', 'qboards.v1.a.{id}', 'Stores a selected file separately with the ATTACHMENT service.'],
] as const;

export const BOARD_REFERENCE_EXAMPLES = {
  capabilities: `const actions = await qdnRequest({ action: 'SHOW_ACTIONS' });
const has = (action) =>
  actions.some((available) => available.toUpperCase() === action);

const capabilities = {
  publishRecord: has('PUBLISH_QDN_RESOURCE'),
  publishAttachment:
    has('SELECT_QDN_PUBLISH_SOURCE') &&
    has('PUBLISH_QDN_RESOURCE'),
  createPoll: has('CREATE_POLL'),
  voteOnPoll: has('VOTE_ON_POLL'),
  sendTip: has('SEND_COIN'),
};

// Publishing also requires Qortium Home and a registered QDN name
// writable by the selected account. SEND_COIN is disabled on public nodes.`,
  publishThread: `const record = {
  schema: '${BOARD_SCHEMA}',
  kind: 'thread',
  id: 'mabc1234example',
  createdAt: Date.now(),
  topicId: 'mabc1234topic',
  title: 'A verifiable discussion',
  body: 'The thread body is public QDN data.',
  attachments: [],
  poll: null,
};

await qdnRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  service: '${BOARD_SERVICE}',
  name: selectedWritableName,
  identifier: '${IDENTIFIERS.thread}' + record.id,
  filename: '${BOARD_FILE_NAME}',
  title: record.title.slice(0, 80),
  description: record.body.slice(0, 240),
  tags: ['qortium-boards', 'thread', 'discussion'],
  base64: jsonToBase64(record), // UTF-8 JSON encoded as base64
});`,
  verifyResource: `const tx = await qdnRequest({
  action: 'FETCH_NODE_API',
  path: '/transactions/signature/' + resource.latestSignature,
  maxBytes: 150_000,
});

const authentic =
  tx.type === 'ARBITRARY' &&
  tx.blockHeight > 0 &&
  tx.creatorAddress &&
  tx.name === resource.name &&
  tx.identifier === resource.identifier &&
  tx.signature === resource.latestSignature;

// Only after this check does Boards fetch and normalize board.json.`,
  publishAttachment: `const selected = await qdnRequest({
  action: 'SELECT_QDN_PUBLISH_SOURCE',
  kind: 'file',
});

if (!selected.canceled) {
  await qdnRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'ATTACHMENT',
    name: selectedWritableName,
    identifier: 'qboards.v1.a.' + attachmentId,
    sourceToken: selected.sourceToken,
    title: selected.fileName.slice(0, 80),
  });
}

// Store { service, name, identifier, filename, size } in the
// later thread or post record. These are two separate public writes.`,
  nativePoll: `await qdnRequest({
  action: 'CREATE_POLL',
  pollName: ('boards-' + threadId).slice(0, 40),
  description: threadTitle,
  pollOptions: options.map((optionName) => ({ optionName })),
  endTime,
});

await qdnRequest({
  action: 'VOTE_ON_POLL',
  pollId,
  optionIndexes: [selectedOptionIndex + 1],
});`,
} as const;

type CodeExampleProps = {
  code: string;
  id: keyof typeof BOARD_REFERENCE_EXAMPLES;
  label: string;
};

function CodeExample({ code, id, label }: CodeExampleProps) {
  const [copyState, setCopyState] = useState<'copied' | 'idle' | 'unavailable'>('idle');

  async function copy() {
    setCopyState(await copyTextToClipboard(code) ? 'copied' : 'unavailable');
  }

  return (
    <div className="reference-code" id={`reference-example-${id}`}>
      <header>
        <strong>{label}</strong>
        <button className="button button--quiet" onClick={() => void copy()} type="button">
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </header>
      <pre>
        <code>{code}</code>
      </pre>
      <span aria-live="polite" className="sr-only">
        {copyState === 'copied'
          ? `${label} copied.`
          : copyState === 'unavailable'
            ? 'Clipboard access is unavailable. Select the code manually.'
            : ''}
      </span>
    </div>
  );
}

export type BoardsReferenceProps = {
  onBack?: () => void;
};

export function BoardsReference({ onBack }: BoardsReferenceProps) {
  return (
    <article className="developer-reference">
      <header className="reference-hero">
        <div>
          <span className="eyebrow">Always-English protocol reference</span>
          <h1>Boards developer reference</h1>
          <p>
            The source and confirmed Qortium transactions are authoritative. This page
            describes the current Boards v1 storage, validation and reduction contracts.
          </p>
        </div>
        {onBack ? (
          <button className="button button--secondary" onClick={onBack} type="button">
            Back to discussions
          </button>
        ) : null}
      </header>

      <nav aria-label="Developer reference sections" className="reference-toc">
        <a href="#reference-records">Records</a>
        <a href="#reference-identifiers">Identifiers</a>
        <a href="#reference-authenticity">Authenticity</a>
        <a href="#reference-state">State reduction</a>
        <a href="#reference-links">Direct links</a>
        <a href="#reference-features">Polls, files and tips</a>
        <a href="#reference-bridge">Bridge examples</a>
      </nav>

      <section className="reference-section" id="reference-records">
        <header>
          <span className="eyebrow">Data contract</span>
          <h2>Records and QDN storage</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Envelope</h3>
            <p>
              Every accepted record has <code>schema: "{BOARD_SCHEMA}"</code>, a non-empty
              id, a positive numeric <code>createdAt</code>, and one recognized kind.
              Payload timestamps are descriptive; they never determine authority or chain
              order.
            </p>
            <p>
              Board JSON uses service <code>{BOARD_SERVICE}</code>, filename{' '}
              <code>{BOARD_FILE_NAME}</code>, and an app-side publish ceiling of 24,000
              UTF-8 bytes. Readers fetch at most 25,000 bytes per record.
            </p>
          </article>
          <article className="reference-card">
            <h3>Content kinds</h3>
            <ul>
              <li><code>topic</code>: title, description and up to five tags.</li>
              <li><code>thread</code>: topic id, title, body, attachments and optional native poll reference.</li>
              <li><code>post</code>: thread id, body, optional reply target and attachments.</li>
              <li><code>edit</code>: an author patch or public deletion tombstone.</li>
            </ul>
          </article>
          <article className="reference-card">
            <h3>Independent state kinds</h3>
            <ul>
              <li><code>reaction</code>: {REACTION_VALUES.join(', ')}, or null to remove the current reaction.</li>
              <li><code>moderation</code>: hide/show, lock/unlock, pin/unpin or solve/unsolve.</li>
              <li><code>tip</code>: amount, recipient and PAYMENT transaction signature.</li>
              <li><code>config</code>: board title plus administrator and moderator addresses.</li>
            </ul>
          </article>
          <aside className="reference-callout">
            <strong>Metadata is an index, not the record.</strong>
            <p>
              Topic, thread and reply titles/descriptions are shortened for QDN metadata.
              The normalized JSON payload remains the source of application state.
            </p>
          </aside>
        </div>
      </section>

      <section className="reference-section" id="reference-identifiers">
        <header>
          <span className="eyebrow">Resource tuples</span>
          <h2>Identifiers</h2>
        </header>
        <div className="reference-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Identifier</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {IDENTIFIER_ROWS.map(([label, identifier, meaning]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td><code>{identifier}</code></td>
                    <td>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="reference-callout">
          <strong>QDN identifiers are limited to 64 bytes.</strong>
          <p>
            Boards identifiers are ASCII. The current builder rejects overlong generated
            topic, thread, post, edit, moderation and tip identifiers; app-generated ids
            keep reaction and attachment identifiers within the same QDN limit.
          </p>
        </aside>
      </section>

      <section className="reference-section" id="reference-authenticity">
        <header>
          <span className="eyebrow">Trust boundary</span>
          <h2>Confirmed transaction validation</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Resource authentication</h3>
            <p>
              Search results are candidates, not trusted records. Boards fetches each latest
              signature and accepts it only when Core returns a confirmed{' '}
              <code>ARBITRARY</code> transaction whose name, identifier and signature match
              the resource listing and whose creator address is present.
            </p>
            <p>
              The confirmed transaction creator address becomes the record owner. The QDN
              name is retained for display, but a name string alone does not grant edit,
              reaction or moderation authority.
            </p>
          </article>
          <article className="reference-card">
            <h3>Root authority</h3>
            <p>
              Boards first derives the root address from the confirmed{' '}
              <code>APP/{BOARD_ROOT_NAME}/{BOARD_ROOT_NAME}</code> publication. Before a
              usable app publication is available, it falls back to the current owner of the{' '}
              <code>{BOARD_ROOT_NAME}</code> name.
            </p>
            <p>
              Only configuration records created by that address are accepted. The latest
              accepted configuration adds administrator and moderator addresses.
            </p>
          </article>
        </div>
        <CodeExample
          code={BOARD_REFERENCE_EXAMPLES.verifyResource}
          id="verifyResource"
          label="Verify a resource candidate"
        />
      </section>

      <section className="reference-section" id="reference-state">
        <header>
          <span className="eyebrow">Deterministic view</span>
          <h2>Ordering, edits, reactions and moderation</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Chain order</h3>
            <p>
              Boards sorts accepted records by confirmed block height, then transaction
              signature. For duplicate create ids, the first record in that order wins.
              Later payload timestamps cannot jump ahead of earlier confirmed transactions.
            </p>
          </article>
          <article className="reference-card">
            <h3>Author edits</h3>
            <p>
              An edit applies only when its transaction creator address equals the original
              topic, thread or post creator address. Edits can update supported fields or
              publish a deletion tombstone, but cannot erase the earlier public QDN history.
            </p>
          </article>
          <article className="reference-card">
            <h3>Reactions</h3>
            <p>
              Reactions cannot overwrite content. Boards keeps the latest confirmed
              reaction per creator address and target. Publishing <code>null</code> clears
              that address&apos;s reaction.
            </p>
          </article>
          <article className="reference-card">
            <h3>Moderation</h3>
            <p>
              Only root, administrator or moderator creator addresses affect reduced state.
              Authorized actions are replayed in confirmed chain order, so a later unlock,
              unpin, show or unsolve reverses its paired action.
            </p>
          </article>
        </div>
      </section>

      <section className="reference-section" id="reference-links">
        <header>
          <span className="eyebrow">Addressing</span>
          <h2>Topic, thread and reply links</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Stable query routes</h3>
            <p>
              Topic links use <code>?topic={'{topicId}'}</code>. Thread links use{' '}
              <code>?thread={'{threadId}'}</code>, and an individual reply adds{' '}
              <code>&amp;post={'{postId}'}</code>. The thread id remains required so Boards
              can reject a post id that belongs to another conversation.
            </p>
          </article>
          <article className="reference-card">
            <h3>Mirror-safe QDN identity</h3>
            <p>
              Copied links use <code>qdn://service/name/identifier</code> from Core&apos;s
              injected render globals. The app falls back to its render path and then{' '}
              <code>qdn://APP/Boards/Boards</code> during local development.
            </p>
          </article>
          <aside className="reference-callout">
            <strong>Unavailable replies do not hide the thread.</strong>
            <p>
              If a requested reply is deleted, hidden, missing, or associated with another
              thread, Boards explains that the target is unavailable and continues showing
              the valid conversation.
            </p>
          </aside>
        </div>
      </section>

      <section className="reference-section" id="reference-features">
        <header>
          <span className="eyebrow">Related transactions</span>
          <h2>Native polls, attachments and tips</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Native polls</h3>
            <p>
              A thread stores only a poll name and optional poll id. Creation and voting are
              Core transactions through <code>CREATE_POLL</code> and{' '}
              <code>VOTE_ON_POLL</code>; reads use <code>GET /polls/{'{pollName}'}</code>{' '}
              and <code>GET /polls/votes/id/{'{pollId}'}?onlyCounts=false</code>. The
              current single-choice UI submits a one-based option index.
            </p>
          </article>
          <article className="reference-card">
            <h3>Attachments</h3>
            <p>
              Home selects a local file and returns an opaque source token. Boards passes
              that token to <code>PUBLISH_QDN_RESOURCE</code> with the{' '}
              <code>ATTACHMENT</code> service, then stores its public resource reference in a
              later thread or post JSON record.
            </p>
            <p>
              Attachment and record publication are separate and not atomic. A published
              attachment can remain public if the later record is canceled or fails.
            </p>
          </article>
          <article className="reference-card">
            <h3>Tip receipts</h3>
            <p>
              <code>SEND_COIN</code> returns a transaction signature. Before counting the
              receipt, Boards requires a confirmed <code>PAYMENT</code> whose creator is the
              receipt publisher, whose recipient matches the record, and whose QORT amount
              matches within 0.00000001.
            </p>
          </article>
          <aside className="reference-callout">
            <strong>All Boards content is public.</strong>
            <p>
              Topics, posts, edits, reactions, moderation, receipts and attachments are
              durable QDN or blockchain data. Hidden and deleted states affect the reduced
              interface; they do not provide privacy or physical erasure.
            </p>
          </aside>
        </div>
        <div className="reference-grid">
          <CodeExample
            code={BOARD_REFERENCE_EXAMPLES.nativePoll}
            id="nativePoll"
            label="Create and vote on a native poll"
          />
          <CodeExample
            code={BOARD_REFERENCE_EXAMPLES.publishAttachment}
            id="publishAttachment"
            label="Publish an attachment from a source token"
          />
        </div>
      </section>

      <section className="reference-section" id="reference-bridge">
        <header>
          <span className="eyebrow">Qortium Home bridge</span>
          <h2>Feature detection and publication</h2>
        </header>
        <div className="reference-grid">
          <article className="reference-card">
            <h3>Detect each operation</h3>
            <p>
              Call <code>SHOW_ACTIONS</code> and check the exact action required for each
              control. Do not infer poll creation from vote support, or source selection from
              general QDN publishing support.
            </p>
            <p>
              Reading can fall back to a local node in browser development. Account context,
              source selection and every write action require Qortium Home approval and the
              relevant advertised action.
            </p>
          </article>
          <article className="reference-card">
            <h3>Read discovery</h3>
            <p>
              Boards searches each v1 identifier prefix with service{' '}
              <code>{BOARD_SERVICE}</code>, newest listings first, in pages of 100. It
              currently examines at most 30 pages per prefix before authenticating the
              returned resources.
            </p>
          </article>
        </div>
        <div className="reference-grid">
          <CodeExample
            code={BOARD_REFERENCE_EXAMPLES.capabilities}
            id="capabilities"
            label="Detect bridge capabilities"
          />
          <CodeExample
            code={BOARD_REFERENCE_EXAMPLES.publishThread}
            id="publishThread"
            label="Publish a thread record"
          />
        </div>
      </section>
    </article>
  );
}

export const Reference = BoardsReference;
