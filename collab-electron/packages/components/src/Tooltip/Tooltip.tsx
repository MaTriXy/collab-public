import React, { useState, useRef, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import "./Tooltip.css";

interface TooltipProps {
	label: string;
	delayMs?: number;
	children: React.ReactElement;
}

export function Tooltip({ label, delayMs = 1000, children }: TooltipProps) {
	const [rect, setRect] = useState<DOMRect | null>(null);
	const [left, setLeft] = useState<number | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const buttonRef = useRef<HTMLElement | null>(null);
	const tooltipRef = useRef<HTMLSpanElement | null>(null);

	const handleMouseEnter = (e: React.MouseEvent) => {
		buttonRef.current = e.currentTarget as HTMLElement;
		timerRef.current = setTimeout(() => {
			if (buttonRef.current) {
				setRect(buttonRef.current.getBoundingClientRect());
			}
		}, delayMs);
	};

	const handleMouseLeave = () => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setRect(null);
		setLeft(null);
	};

	useLayoutEffect(() => {
		if (rect && tooltipRef.current) {
			const tip = tooltipRef.current.getBoundingClientRect();
			const centeredLeft = rect.left + rect.width / 2;
			const overflow = (centeredLeft + tip.width / 2) - (window.innerWidth - 8);
			setLeft(overflow > 0 ? centeredLeft - overflow : centeredLeft);
		}
	}, [rect]);

	const tooltip = rect
		? ReactDOM.createPortal(
			<span
				ref={tooltipRef}
				className="tooltip"
				role="tooltip"
				style={{
					position: "fixed",
					top: rect.top - 6,
					left: left ?? rect.left + rect.width / 2,
					transform: "translate(-50%, -100%)",
					visibility: left === null ? "hidden" : "visible",
				}}
			>
				{label}
			</span>,
			document.body,
		)
		: null;

	return (
		<>
			{React.cloneElement(children, {
				onMouseEnter: handleMouseEnter,
				onMouseLeave: handleMouseLeave,
			})}
			{tooltip}
		</>
	);
}
