from workers import WorkerEntrypoint  # pyright: ignore[reportMissingImports]
import asgi  # pyright: ignore[reportMissingImports]
from app import app


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)
