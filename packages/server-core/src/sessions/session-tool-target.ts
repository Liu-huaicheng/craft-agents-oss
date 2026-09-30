/**
 * Target resolution for the session self-management tools (set_session_status,
 * set_session_labels, get_session_info, list_background_tasks). Extracted from
 * the SessionManager callbacks so it is unit-testable.
 *
 * `sessionId` is optional in the tool schema, but models using strict JSON-schema
 * tool calling must fill every field and send "" to mean "this session". Blank
 * must therefore fall back to the invoking session exactly like an omitted id.
 */
export function resolveToolTargetSessionId(requested: string | undefined, invokingSessionId: string): string {
  return requested?.trim() ? requested : invokingSessionId
}

/**
 * Like resolveToolTargetSessionId, but for writes: throws when the target does
 * not exist so the tool reports an error instead of claiming success for a
 * write that SessionManager would silently skip.
 */
export function resolveWritableToolTarget(
  requested: string | undefined,
  invokingSessionId: string,
  exists: (sessionId: string) => boolean,
): string {
  const targetId = resolveToolTargetSessionId(requested, invokingSessionId)
  if (!exists(targetId)) {
    throw new Error(`Session ${targetId} not found`)
  }
  return targetId
}
