import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import { Printer, X } from 'lucide-react';
import type { Product } from '../types/erp';

interface BarcodeModalProps {
  product: Product;
  onClose: () => void;
}

export const BarcodeModal: React.FC<BarcodeModalProps> = ({ product, onClose }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [copies, setCopies] = useState(4);
  const [showPrice, setShowPrice] = useState(true);

  useEffect(() => {
    document.body.classList.add('printing-modal');
    return () => {
      document.body.classList.remove('printing-modal');
    };
  }, []);

  useEffect(() => {
    if (svgRef.current && product.barcode) {
      try {
        JsBarcode(svgRef.current, product.barcode, {
          format: 'CODE128',
          width: 2,
          height: 54,
          displayValue: true,
          fontSize: 13,
          margin: 6,
        });
      } catch {
        // Fallback handled silently
      }
    }
  }, [product.barcode]);

  const modal = (
    <div className="print-portal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="print-portal-dialog w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 no-print">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            إنشاء وطباعة ملصقات الباركود — {product.name}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-5 no-print">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <span>عدد الملصقات:</span>
            <input
              type="number"
              min={1}
              max={40}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-sm font-mono tabular-nums"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showPrice}
              onChange={(e) => setShowPrice(e.target.checked)}
              className="rounded border-slate-300 text-teal-600"
            />
            <span>إظهار السعر على الملصق</span>
          </label>
          <button
            onClick={() => window.print()}
            className="mr-auto flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#13325b]"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الملصقات</span>
          </button>
        </div>

        <div className="hidden no-print justify-center mb-4">
          <svg ref={svgRef} />
        </div>

        <div className="print-portal-scroll grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
          {Array.from({ length: copies }).map((_, idx) => (
            <BarcodeLabelCard
              key={idx}
              name={product.name}
              barcode={product.barcode}
              price={product.salePrice}
              showPrice={showPrice}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

const BarcodeLabelCard: React.FC<{
  name: string;
  barcode: string;
  price: number;
  showPrice: boolean;
}> = ({ name, barcode, price, showPrice }) => {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (ref.current && barcode) {
      try {
        JsBarcode(ref.current, barcode, {
          format: 'CODE128',
          width: 1.5,
          height: 36,
          displayValue: true,
          fontSize: 11,
          margin: 3,
        });
      } catch {
        // ignore invalid format
      }
    }
  }, [barcode]);

  return (
    <div className="bg-white text-slate-900 border border-slate-300 rounded-md p-2 flex flex-col items-center text-center">
      <div className="text-[11px] font-bold line-clamp-1 mb-1">{name}</div>
      <svg ref={ref} className="max-w-full" />
      {showPrice && (
        <div className="text-xs font-extrabold font-mono tabular-nums text-[#0B1F3A] mt-0.5">
          {price.toFixed(2)} ج.م
        </div>
      )}
    </div>
  );
};
