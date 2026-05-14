from __future__ import annotations

from abc import ABC, abstractmethod

from reportagent.models.schemas import UserCriteria, SearchResult, SourceType


class BaseSource(ABC):
    @abstractmethod
    async def search(self, criteria: UserCriteria) -> list[SearchResult]:
        ...

    @abstractmethod
    def is_available(self) -> bool:
        ...

    @property
    @abstractmethod
    def source_type(self) -> SourceType:
        ...
