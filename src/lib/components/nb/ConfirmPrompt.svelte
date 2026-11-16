<script>
  /**
   * ConfirmPrompt — the action would interrupt something; say what, then let the
   * reader choose.
   *
   * Lifted from galactic-unicorn-remote's conflict affordance: pressing
   * "Bathtime" while "Booktime" is running answers 409, and the honest UI is not
   * a toast that vanished — it is a question with two answers, Replace and Keep.
   * The alternative was a silent switch to the newly pressed routine, which is
   * how two people end up disagreeing about what the panel is doing.
   *
   * `element` is `$bindable` on purpose: a disclosure that asks for a decision
   * has to move focus to it, and *which* answer deserves focus is the caller's
   * judgement (the safer one, usually). A block that focused its own confirm
   * button would be making that judgement for a page it cannot see.
   *
   * `tone` names the interruption's weight: warn (another thing is running),
   * bad (this destroys something), accent (a choice that is merely pending).
   */
  let {
    message = "",
    confirmLabel = "Replace",
    cancelLabel = "Keep",
    tone = "warn",
    onconfirm,
    oncancel,
    element = $bindable(),
  } = $props();

  const id = $props.id();
</script>

<div
  class="card prompt tone-{tone}"
  role="alertdialog"
  aria-labelledby={id}
>
  <p id={id} class="message">{message}</p>
  <div class="actions">
    <button type="button" class="btn primary confirm" bind:this={element} onclick={onconfirm}>
      {confirmLabel}
    </button>
    <button type="button" class="btn keep" onclick={oncancel}>
      {cancelLabel}
    </button>
  </div>
</div>

<style>
  .prompt {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-width: 2px;
  }

  .message {
    margin: 0;
    font-weight: 600;
  }

  .tone-warn {
    border-color: var(--warn);
  }
  .tone-warn .message {
    color: var(--warn);
  }
  .tone-bad {
    border-color: var(--bad);
  }
  .tone-bad .message {
    color: var(--bad);
  }
  .tone-accent {
    border-color: var(--accent);
  }
  .tone-accent .message {
    color: var(--accent);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .actions .btn {
    min-height: var(--tap);
    justify-content: center;
    font-weight: 700;
  }
</style>
