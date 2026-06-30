<script lang="ts">
	import { tStore } from '../../../../shared/locales/index';
	import { indexingState, indexingProgress, estimatedTimeRemaining } from '../../../../core/store/ragStore';
</script>

<div class="lumina-discovery__rag-banner">
	<div class="lumina-discovery__rag-banner-content">
		{#if $indexingState.status === 'loading-model'}
			<strong>{$tStore('settings.rag.init.loadingModel') || 'RAG 모델 다운로드 중...'}</strong>
			<span>{$tStore('settings.rag.init.loadingModelDesc') || ''}</span>
		{:else}
			<strong>{$tStore('settings.rag.init.indexingVault') || '내 노트 인덱싱 중...'}</strong>
			<span>
				{($tStore('settings.rag.init.indexingProgressText') || '')
					.replace('{{processed}}', $indexingState.processedFiles.toString())
					.replace('{{total}}', $indexingState.totalFiles.toString())
					.replace('{{pct}}', $indexingProgress.toString())}
				{#if $estimatedTimeRemaining !== null}
					{$tStore('settings.rag.init.remainingTimePrefix') || ''}{$estimatedTimeRemaining < 60
						? ($tStore('settings.rag.init.remainingTimeSec') || '').replace('{{sec}}', $estimatedTimeRemaining.toString())
						: ($tStore('settings.rag.init.remainingTimeMinSec') || '')
								.replace('{{min}}', Math.floor($estimatedTimeRemaining / 60).toString())
								.replace('{{sec}}', ($estimatedTimeRemaining % 60).toString())}
				{/if}
			</span>
		{/if}
	</div>
</div>

<style>
	@keyframes lumina-pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.lumina-discovery__rag-banner {
		margin: 8px 8px 0;
		flex-shrink: 0;
		padding: 12px 16px;
		background: rgba(139, 92, 246, 0.08);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 8px;
		animation: lumina-pulse 2.5s ease-in-out infinite;
	}

	.lumina-discovery__rag-banner-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-discovery__rag-banner-content strong {
		color: var(--interactive-accent);
		font-size: 13px;
	}

	.lumina-discovery__rag-banner-content span {
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
