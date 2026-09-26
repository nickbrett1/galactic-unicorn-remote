<script>
  /**
   * Root layout — exists only to load the global token stylesheet once for
   * every route. The token block moved out of `/`'s component when the
   * read-only tile (`/tile`) was added, so both surfaces share one palette
   * (`spec/ui/design-system.md` §2).
   */
  import "../app.css";

  let { children } = $props();
</script>

{@render children()}
