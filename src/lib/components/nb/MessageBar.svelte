<script>
  /**
   * MessageBar — one short line sent *to* something.
   *
   * Lifted from galactic-unicorn-remote's idle-only composer: a message that
   * scrolls across the panel's LED matrix. It is deliberately not `request-form`:
   * that block is schema-driven, renders a field per rule and answers with one
   * error message per failed constraint. This is one line, one limit, one
   * button, and the interesting states are "empty", "sending" and "sent".
   *
   * `sanitize` is the caller's character rule (the panel's LED font has no
   * glyph for a curly quote or an emoji) and is applied on every keystroke, not
   * on submit: a field that visibly accepts something the receiver will refuse
   * is a lie the user only discovers after pressing Send. The block owns the
   * write-back, because a dropped character leaves the bound value unchanged and
   * the DOM would otherwise keep showing what was just refused.
   *
   * The field is wrapped by its `<label>`, so the caller passes the words and no
   * id has to be coordinated across two components.
   */
  let {
    label = "Message",
    placeholder = "",
    maxLength = null,
    submitLabel = "Send",
    hint = "",
    value = $bindable(""),
    disabled = false,
    pending = false,
    sanitize = (text) => text,
    onsubmit,
  } = $props();

  const empty = $derived(value.trim().length === 0);

  function onInput(event) {
    const clean = sanitize(event.currentTarget.value);
    // Write it back even when it matches the previous value: a refused emoji
    // leaves `value` unchanged, and without this the input would still show it.
    if (clean !== event.currentTarget.value) event.currentTarget.value = clean;
    value = clean;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const text = value.trim();
    if (!text || disabled || pending) return;
    onsubmit?.(text);
  }
</script>

<form class="message" onsubmit={handleSubmit}>
  <label class="field">
    <span class="sr-only">{label}</span>
    <input
      type="text"
      {placeholder}
      maxlength={maxLength ?? undefined}
      value={value}
      {disabled}
      oninput={onInput}
    />
  </label>
  <button
    type="submit"
    class="btn primary send"
    disabled={disabled || pending || empty}
    aria-busy={pending ? "true" : undefined}
    class:pending
  >
    {submitLabel}
  </button>
</form>

{#if hint}
  <p class="hint">{hint}</p>
{/if}

<style>
  .message {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
  }

  .field {
    display: block;
    min-width: 0;
  }

  .field input {
    width: 100%;
    min-height: var(--tap);
  }

  .send {
    min-height: var(--tap);
    padding: 0 16px;
    font-weight: 700;
  }

  .send.pending {
    opacity: 0.7;
  }

  /* Visually hidden, still the field's accessible name. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
