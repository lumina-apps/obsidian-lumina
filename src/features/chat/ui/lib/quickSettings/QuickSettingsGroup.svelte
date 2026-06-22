<script lang="ts">
	/**
	 * QuickSettingsGroup — 온도 / 토큰 길이 버튼 그룹 공통 컴포넌트.
	 *
	 * 프리셋 배열을 받아 동일한 마크업으로 렌더링하며,
	 * is-active 판정은 앞 항목의 threshold를 기준으로 합니다.
	 * 모든 텍스트는 부모에서 번역된 문자열을 받습니다.
	 */

	export interface PresetItem {
		value: number;
		label: string;
	}

	let {
		label,
		labelId,
		presets,
		currentValue,
		onSelect,
	}: {
		label: string;
		labelId: string;
		presets: PresetItem[];
		currentValue: number;
		onSelect: (value: number) => void;
	} = $props();

	function isActive(index: number): boolean {
		return currentValue === presets[index].value;
	}
</script>

<div class="lumina-qs__section">
	<span class="lumina-qs__label" id={labelId}>{label} ({currentValue})</span>
	<div class="lumina-qs__btn-group" role="group" aria-labelledby={labelId}>
		{#each presets as preset, i}
			<button
				class="lumina-qs__btn"
				class:is-active={isActive(i)}
				onclick={() => onSelect(preset.value)}
				data-tooltip={preset.value}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>

<style>
	.lumina-qs__btn-group {
		display: flex;
		background: var(--background-secondary);
		border-radius: 6px;
		padding: 2px;
		gap: 2px;
	}

	.lumina-qs__btn {
		flex: 1;
		background: transparent;
		border: none;
		border-radius: 4px;
		padding: 4px 0;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
		position: relative;
	}

	.lumina-qs__btn[data-tooltip]::before {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--text-normal);
		color: var(--background-primary);
		padding: 3px 6px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		z-index: 10;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.lumina-qs__btn[data-tooltip]:hover::before {
		opacity: 1;
		visibility: visible;
	}

	.lumina-qs__btn:hover {
		color: var(--text-normal);
	}

	.lumina-qs__btn.is-active {
		background: var(--interactive-accent);
		color: white;
		font-weight: 600;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	}
</style>