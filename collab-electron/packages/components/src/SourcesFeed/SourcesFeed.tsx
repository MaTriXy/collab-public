import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { TreeNode } from '@collab/shared/types';
import {
	FileRow,
	SearchSortControls,
} from '@collab/components/TreeView';
import type {
	FlatItem,
	SearchSortControlsHandle,
} from '@collab/components/TreeView';
import {
	getDateKey,
	formatDateLabel,
} from '@collab/components/TreeView';
import type { SortMode } from '@collab/components/TreeView';

interface FeedItem {
	path: string;
	name: string;
	ctime: string;
	mtime: string;
}

function flattenToFiles(
	nodes: TreeNode[],
	sortMode: SortMode,
): FeedItem[] {
	const items: FeedItem[] = [];

	function walk(list: TreeNode[]) {
		for (const node of list) {
			if (
				node.kind === 'folder' &&
				node.children
			) {
				walk(node.children);
			} else if (
				node.kind === 'file'
			) {
				const fileName =
					node.path
						.split(/[\\/]/)
						.pop() ??
					node.name;
				items.push({
					path: node.path,
					name: fileName,
					ctime: node.ctime,
					mtime: node.mtime,
				});
			}
		}
	}

	walk(nodes);

	if (sortMode.startsWith('alpha')) {
		const isDesc = sortMode === 'alpha-desc';
		items.sort((a, b) => {
			const cmp = a.name.localeCompare(b.name);
			return isDesc ? -cmp : cmp;
		});
	} else {
		const field = sortMode.startsWith('modified')
			? 'mtime'
			: 'ctime';
		const asc = sortMode.endsWith('-asc');
		items.sort((a, b) => {
			const diff =
				new Date(a[field]).getTime() -
				new Date(b[field]).getTime();
			return asc ? diff : -diff;
		});
	}

	return items;
}

function feedItemToFlatItem(item: FeedItem): FlatItem {
	return {
		id: item.path,
		kind: 'file',
		level: 0,
		name: item.name,
		path: item.path,
		ctime: item.ctime,
		mtime: item.mtime,
	};
}

interface SourcesFeedProps {
	workspacePath: string;
	selectedPath: string | null;
	sortMode: SortMode;
	isActive?: boolean;
	onSelectFile: (path: string) => void;
	onDeleteFile: (path: string) => void;
	onCycleSortMode: () => void;
	onDragStart?: (e: React.DragEvent, path: string) => void;
	leadingContent?: React.ReactNode;
	searchRef?: React.RefObject<SearchSortControlsHandle | null>;
}

export const SourcesFeed: React.FC<
	SourcesFeedProps
> = ({
	workspacePath,
	selectedPath,
	sortMode,
	isActive = true,
	onSelectFile,
	onDeleteFile,
	onCycleSortMode,
	onDragStart,
	leadingContent,
	searchRef,
}) => {
	const [items, setItems] = useState<FeedItem[]>(
		[],
	);
	const [searchQuery, setSearchQuery] =
		useState('');

	const [deleteConfirmPath, setDeleteConfirmPath] =
		useState<string | null>(null);
	const deleteConfirmRef = useRef(
		deleteConfirmPath,
	);
	deleteConfirmRef.current = deleteConfirmPath;
	const scrollRef =
		useRef<HTMLDivElement>(null);
	const lastSelectedIndexRef = useRef(-1);

	const loadFeed = useCallback(async () => {
		if (!workspacePath) return;
		try {
			const tree =
				await window.api.readTree({
					root: workspacePath,
				});
			setItems(
				flattenToFiles(tree, sortMode),
			);
		} catch (err) {
			console.error(
				'Failed to load feed:',
				err,
			);
		}
	}, [workspacePath, sortMode]);

	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const debouncedLoadFeed = useCallback(() => {
		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(loadFeed, 150);
	}, [loadFeed]);

	useEffect(() => {
		return () => clearTimeout(debounceRef.current);
	}, []);

	useEffect(() => {
		loadFeed();
	}, [loadFeed]);

	useEffect(() => {
		return window.api.onFsChanged(() => {
			debouncedLoadFeed();
		});
	}, [debouncedLoadFeed]);

	useEffect(() => {
		return window.api.onFileRenamed(() => {
			debouncedLoadFeed();
		});
	}, [debouncedLoadFeed]);

	useEffect(() => {
		return window.api.onFilesDeleted(() => {
			debouncedLoadFeed();
		});
	}, [debouncedLoadFeed]);

	const filteredItems = useMemo(() => {
		const query = searchQuery
			.trim()
			.toLowerCase();
		if (!query) return items;
		return items.filter((item) =>
			item.name.toLowerCase().includes(query),
		);
	}, [items, searchQuery]);

	const groupedItems = useMemo(() => {
		if (sortMode.startsWith('alpha')) {
			const map = new Map<
				string,
				{ key: string; label: string; items: FeedItem[] }
			>();
			for (const item of filteredItems) {
				const letter = (
					item.name[0] ?? '#'
				).toUpperCase();
				const existing = map.get(letter);
				if (existing) {
					existing.items.push(item);
				} else {
					map.set(letter, {
						key: letter,
						label: letter,
						items: [item],
					});
				}
			}
			return [...map.values()];
		}

		const dateField =
			sortMode.startsWith('modified')
				? 'mtime'
				: 'ctime';
		const map = new Map<
			string,
			{ key: string; label: string; items: FeedItem[] }
		>();

		for (const item of filteredItems) {
			const key = getDateKey(item[dateField]);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(item);
			} else {
				map.set(key, {
					key,
					label: formatDateLabel(
						item[dateField],
					),
					items: [item],
				});
			}
		}

		return [...map.values()];
	}, [filteredItems, sortMode]);

	useEffect(() => {
		const idx = filteredItems.findIndex(
			(d) => d.path === selectedPath,
		);
		if (idx >= 0)
			lastSelectedIndexRef.current = idx;
	}, [filteredItems, selectedPath]);

	const navigateItems = useCallback(
		(direction: 'up' | 'down', _shiftKey?: boolean) => {
			if (filteredItems.length === 0) return;

			let currentIndex = filteredItems.findIndex(
				(d) => d.path === selectedPath,
			);

			if (
				currentIndex < 0 &&
				lastSelectedIndexRef.current >= 0
			) {
				currentIndex = Math.min(
					lastSelectedIndexRef.current,
					filteredItems.length - 1,
				);
			}

			let nextIndex: number;
			if (direction === 'down') {
				nextIndex =
					currentIndex < 0
						? 0
						: Math.min(
								currentIndex + 1,
								filteredItems.length - 1,
							);
			} else {
				nextIndex =
					currentIndex < 0
						? 0
						: Math.max(
								currentIndex - 1,
								0,
							);
			}

			lastSelectedIndexRef.current = nextIndex;
			const next = filteredItems[nextIndex];
			if (!next) return;

			onSelectFile(next.path);

			const container = scrollRef.current;
			const el = container?.querySelector(
				`[data-item-id="${CSS.escape(next.path)}"]`,
			);
			if (el && container) {
				const elRect =
					el.getBoundingClientRect();
				const boxRect =
					container.getBoundingClientRect();
				const top =
					elRect.top - boxRect.top;
				const bottom =
					elRect.bottom - boxRect.top;

				if (top < 0) {
					container.scrollTop += top;
				} else if (
					bottom > container.clientHeight
				) {
					container.scrollTop +=
						bottom -
						container.clientHeight;
				}
			}
		},
		[filteredItems, onSelectFile, selectedPath],
	);

	useEffect(() => {
		if (!isActive) return;

		const handleKeyDown = (
			e: KeyboardEvent,
		) => {
			if (
				e.key !== 'ArrowUp' &&
				e.key !== 'ArrowDown'
			)
				return;

			const active = document.activeElement;
			if (
				active?.tagName === 'INPUT' ||
				active?.tagName === 'TEXTAREA'
			)
				return;

			e.preventDefault();
			navigateItems(
				e.key === 'ArrowDown' ? 'down' : 'up',
			);
		};

		window.addEventListener(
			'keydown',
			handleKeyDown,
		);
		return () =>
			window.removeEventListener(
				'keydown',
				handleKeyDown,
			);
	}, [isActive, navigateItems]);

	const handleItemClick = useCallback(
		(path: string, _e: { metaKey: boolean; shiftKey: boolean }) => {
			onSelectFile(path);
		},
		[onSelectFile],
	);

	const handleDelete = useCallback(
		(e: React.MouseEvent, path: string) => {
			e.preventDefault();
			e.stopPropagation();
			if (
				deleteConfirmRef.current === path
			) {
				onDeleteFile(path);
				setDeleteConfirmPath(null);
			} else {
				setDeleteConfirmPath(path);
			}
		},
		[onDeleteFile],
	);

	const handleDeleteCancel = useCallback(() => {
		setDeleteConfirmPath(null);
	}, []);

	return (
		<div className="table-container items-table">
			<SearchSortControls
				ref={searchRef}
				leadingContent={leadingContent}
				searchQuery={searchQuery}
				onSearchQueryChange={setSearchQuery}
				sortMode={sortMode}
				onCycleSortMode={onCycleSortMode}
				onArrowNav={navigateItems}
			/>
			<div className="table-wrapper">
				<div
					ref={scrollRef}
					className="table-body-scroll scrollbar-hover"
				>
					{groupedItems.map((group) => (
						<div key={group.key}>
							<div className="feed-date-separator">
								{group.label}
							</div>
							{group.items.map(
								(item) => (
									<FileRow
										key={item.path}
										item={feedItemToFlatItem(item)}
										isSelected={
											item.path ===
											selectedPath
										}
										isDeleteConfirm={
											deleteConfirmPath ===
											item.path
										}
										onItemClick={handleItemClick}
										onDelete={handleDelete}
										onDeleteCancel={handleDeleteCancel}
										onDragStart={onDragStart}
										sortMode={sortMode}
									/>
								),
							)}
						</div>
					))}
					{filteredItems.length === 0 && (
						<div className="empty-state">
							<p>
								{searchQuery.trim()
									? 'No matching files'
									: 'No files yet'}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
