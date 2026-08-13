export function isPrismaConnectionError(error) {
  const message = String(error?.message ?? "");

  return (
    error?.name === "PrismaClientInitializationError" ||
    error?.code === "P1001" ||
    message.includes("Can't reach database server")
  );
}

export function reportPublicDataError(scope, error) {
  if (!isPrismaConnectionError(error)) {
    console.error(scope, error);
  }
}
