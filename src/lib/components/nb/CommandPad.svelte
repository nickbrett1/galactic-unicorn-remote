<script>
  /**
   * CommandPad — one press per thing a device (or a page) can do.
   *
   * Lifted from galactic-unicorn-remote's routine buttons: a phone held in one
   * hand in a dim hallway, where the button *is* the interface and each one
   * carries the same picture the physical panel has. The shape is a keypad, not
   * a list, and that is the reason it is not `action-list`: an action row exists
   * to put the valid actions beside a *record's* state, with badges, a note and
   * an aside. Here there is no record — there is a set of commands, each one a
   * large target, and the only per-item state is "not available", "being sent"
   * and "confirmed".
   *
   * `readonly` is the same pad with the affordance removed: a legend of what the
   * device can do, with the active one lit. The tile at `/tile` needs exactly
   * that, and giving it a second block would be two pictures of one keypad.
   *
   * Item shape:
   *   `{ id, label, icon, tone, disabled, span, tall }`
   *   `icon` is a character/glyph the caller owns (the panel's symbols are the
   *   identity channel), rendered `aria-hidden` so the button's name is the
   *   label alone. `tone` is ok | warn | bad | accent. `span: "full"` makes the
   *   item a full-width row -- the one big stop button under the grid.
   *
   * `busyId` and `confirmedId` are ids, not booleans: the pad has to say *which*
   * command is in flight, and only that one should look pressed.
   */
  let {
    items = [],
    label = "",
    columns = 3,
    disabled = false,
    busyId = null,
    confirmedId = null,
    readonly = false,
    onpress,
  } = $props();
</script>

{#if label}
  <p class="section-title">{label}</p>
{/if}

<div
  class="pad"
  class:readonly
  style="--pad-cols: {columns}"
  role={readonly ? "list" : "group"}
  aria-label={label || undefined}
>
  {#if readonly}
    {#each items as item (item.id)}
      <span
        class="chip"
        class:active={item.id === busyId}
        class:off={item.disabled}
        data-command={item.id}
      >
        {#if item.icon}
          <span class="icon" aria-hidden="true">{item.icon}</span>
        {/if}
        <span class="label">{item.label}</span>
      </span>
    {/each}
  {:else}
    {#each items as item (item.id)}
      <button
        type="button"
        class="command tone-{item.tone ?? 'neutral'}"
        class:busy={item.id === busyId}
        class:confirmed={item.id === confirmedId}
        class:full={item.span === "full"}
        class:tall={item.tall}
        data-command={item.id}
        disabled={disabled || item.disabled}
        aria-busy={item.id === busyId ? "true" : undefined}
        onclick={() => onpress?.(item)}
      >
        {#if item.icon}
          <span class="icon" aria-hidden="true">{item.icon}</span>
        {/if}
        <span class="label">{item.label}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(var(--pad-cols, 3), minmax(0, 1fr));
    gap: 8px;
  }

  .command {
    font: inherit;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--ink);
    cursor: pointer;
    width: 100%;
    min-height: var(--tap);
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: background-color 120ms ease;
  }

  .command .icon {
    font-size: 1.7rem;
    line-height: 1;
  }
  .command .label {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .command.full {
    grid-column: 1 / -1;
  }
  .command.tall {
    min-height: calc(var(--tap) * 1.3);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 0.1em;
  }

  /* The three tones that are *decisions*, not decoration: go, stop, and a
     caution. Each is a filled target with the ground as ink, so the label
     keeps its contrast when the theme's tones change. */
  .command.tone-ok {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--bg);
  }
  .command.tone-bad {
    background: var(--bad);
    border-color: var(--bad);
    color: var(--bg);
  }
  .command.tone-warn {
    background: var(--warn);
    border-color: var(--warn);
    color: var(--bg);
  }
  .command.tone-accent {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .command.busy {
    background: color-mix(in srgb, var(--accent) 45%, var(--bg));
    border-color: var(--accent-line-strong);
    color: var(--ink-strong);
  }
  .command.tone-ok.busy {
    background: color-mix(in srgb, var(--ok) 60%, var(--bg));
  }
  .command.tone-bad.busy {
    background: color-mix(in srgb, var(--bad) 60%, var(--bg));
  }

  .command.confirmed {
    animation: confirm 0.7s ease-out;
  }
  @keyframes confirm {
    0% {
      box-shadow: 0 0 0 0 var(--ok);
    }
    100% {
      box-shadow: 0 0 0 14px transparent;
    }
  }

  .command:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  /* Read-only: the same keypad as a legend. No press affordance, no focus —
     the active command is lit, the rest are furniture. */
  .chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px;
    min-height: var(--tap);
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--line);
    color: var(--ink-muted);
    opacity: 0.55;
  }
  .chip .icon {
    font-size: 1.5rem;
    line-height: 1;
  }
  .chip .label {
    font-size: 0.75rem;
    font-weight: 600;
  }
  .chip.active {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--bg);
    opacity: 1;
  }
  .chip.off {
    opacity: 0.3;
  }

  @media (prefers-reduced-motion: reduce) {
    .command.confirmed {
      animation: none;
    }
  }
</style>
