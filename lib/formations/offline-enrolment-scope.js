/**
 * What a member of staff may enrol a student into by hand: STAFF only their
 * own formations (created by them, or animated by them); admins and the owner
 * every formation (null = no filter).
 */
export function staffFormationScope(user) {
  if (user.role !== "STAFF") return null;
  return {
    OR: [
      { createdById: user.id },
      ...(user.email ? [{ animator: { email: user.email } }] : []),
    ],
  };
}

/** The same rule on a FormationSession — a session animated by her counts too. */
export function staffSessionScope(user) {
  if (user.role !== "STAFF") return null;
  return {
    OR: [
      { formation: { createdById: user.id } },
      ...(user.email
        ? [{ formation: { animator: { email: user.email } } }, { animator: { email: user.email } }]
        : []),
    ],
  };
}
