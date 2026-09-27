<script lang="ts">
	import { tStore } from '../../../../shared/locales/index';
	import { stripProviderSuffix, type FlattenedModel } from '../../../../shared/utils/modelUtils';
	import { iconAction } from '../../../../shared/utils/domUtils';

	let {
		filteredModels,
		hasFavorites,
		searchQuery,
		selectedProviderId,
		selectedModelId,
		activeIndex,
		isKeyboardNavigating = false,
		showCheckmark = false,
		onSelect,
		onToggleFavorite,
		onHoverItem,
		onHoverMove,
	}: {
		filteredModels: FlattenedModel[];
		hasFavorites: boolean;
		searchQuery: string;
		selectedProviderId?: string;
		selectedModelId?: string;
		activeIndex: number;
		isKeyboardNavigating?: boolean;
		showCheckmark?: boolean;
		onSelect: (item: FlattenedModel) => void;
		onToggleFavorite?: (providerId: string, modelId: string) => void;
		onHoverItem?: (index: number) => void;
		onHoverMove?: (index: number) => void;
	} = $props();
</script>

{#if filteredModels.length === 0}
	<div class="lumina-popup-selector__empty">{$tStore('uiMessages.noSearchResults')}</div>
{:else}
	{#each filteredModels as item, i}
		{#if !searchQuery && hasFavorites}
			{#if i === 0 && item.isFavorite}
				<div class="lumina-popup-selector__section-header">
					<span class="lumina-popup-selector__section-icon" use:iconAction={'star'}></span>
					{$tStore('uiMessages.favorites')}
				</div>
			{:else if !item.isFavorite && (i === 0 || filteredModels[i - 1].isFavorite)}
				<div class="lumina-popup-selector__section-header lumina-popup-selector__section-divider">
					{$tStore('uiMessages.allModels')}
				</div>
			{/if}
		{/if}
		<div
			class="lumina-popup-selector__item"
			class:is-selected={item.providerId === selectedProviderId && item.modelId === selectedModelId}
			class:is-active={i === activeIndex}
			data-provider-id={item.providerId}
			role="option"
			aria-selected={i === activeIndex}
			tabindex="-1"
			onclick={() => onSelect(item)}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(item);
				}
			}}
			onmouseenter={() => {
				if (!isKeyboardNavigating) onHoverItem?.(i);
			}}
			onmousemove={() => {
				if (!isKeyboardNavigating && activeIndex !== i) onHoverMove?.(i);
			}}
		>
			<div class="lumina-popup-selector__item-info" style="flex-direction: row; align-items: center; gap: 8px;">
				<span class="lumina-popup-selector__item-badge">
					{stripProviderSuffix(item.providerName)}
				</span>
				<span class="lumina-popup-selector__item-name">{item.modelId}</span>
			</div>
			<div class="lumina-model-item__actions">
				<button
					type="button"
					class="lumina-popup-selector__fav-btn"
					class:is-favorite={item.isFavorite}
					aria-label={item.isFavorite ? $tStore('uiMessages.removeFromFavorites') : $tStore('uiMessages.addToFavorites')}
					title={item.isFavorite ? $tStore('uiMessages.removeFromFavorites') : $tStore('uiMessages.addToFavorites')}
					onclick={(e) => {
						e.stopPropagation();
						onToggleFavorite?.(item.providerId, item.modelId);
					}}
				>
					<span use:iconAction={'star'}></span>
				</button>
				{#if showCheckmark && item.providerId === selectedProviderId && item.modelId === selectedModelId}
					<span class="lumina-model-item__check" use:iconAction={'check'}></span>
				{/if}
			</div>
		</div>
	{/each}
{/if}

<style>
	.lumina-model-item__actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.lumina-popup-selector__fav-btn {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0.4;
		transition: all 0.15s ease;
	}

	.lumina-popup-selector__fav-btn:hover {
		opacity: 1;
		color: var(--text-warning, #e5a00d);
		background-color: var(--background-modifier-hover);
	}

	.lumina-popup-selector__fav-btn.is-favorite {
		opacity: 1;
		color: var(--text-warning, #e5a00d);
	}

	.lumina-popup-selector__fav-btn.is-favorite:hover {
		color: var(--text-muted);
	}

	.lumina-popup-selector__fav-btn :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-popup-selector__section-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		user-select: none;
	}

	.lumina-popup-selector__section-icon :global(svg) {
		width: 12px;
		height: 12px;
		color: var(--text-warning, #e5a00d);
	}

	.lumina-popup-selector__section-divider {
		margin-top: 4px;
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 8px;
	}

	.lumina-model-item__check {
		display: flex;
		align-items: center;
		color: var(--interactive-accent);
		flex-shrink: 0;
	}

	.lumina-model-item__check :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-popup-selector__item.is-selected {
		background-color: rgba(var(--color-accent-rgb, 139, 92, 246), 0.1);
		color: var(--interactive-accent);
		font-weight: 600;
	}

	.lumina-popup-selector__item.is-selected .lumina-popup-selector__item-badge {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.2);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}
</style>
