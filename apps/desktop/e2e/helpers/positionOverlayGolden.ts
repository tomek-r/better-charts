// Recorded from the position overlay; see position-overlay-geometry.spec.ts.
export const GOLDEN: Record<string, { ops: string; hit: string }> = {
  'buy position with SL and TP / lines': {
    ops: `clip a1 [41,45,641,445]
fillRect #ff7185 a0.12 [41,245,641,265]
fillRect #6de0ac a0.12 [41,205,641,245]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-buy",
   "y": 265
  }
 ],
 "tpLines": [
  {
   "id": "pos-buy",
   "y": 205
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'buy position with SL and TP / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #26a69a a1 [65,235,85,255]
stroke #26a69a a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [91,235,364.4,255]
stroke #26a69a a1 [91,235,364.4,255]
fill #26a69a a1 [99,230,107,235]
fillText #26a69a a1 [98,245.5,98,245.5] "⋮⋮  P&L "@98,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [217,245.5,217,245.5] "+1.04 USD"@217,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [217,245.5,217,245.5] ""@217,245.5 400 12px system-ui, sans-serif
fill #26a69a a1 [224,241.9,231.2,249.1]
fillText #26a69a a1 [238.2,245.5,238.2,245.5] "1 units"@238.2,245.5 400 12px system-ui, sans-serif
fill #26a69a a1 [294.2,241.9,301.40000000000003,249.1]
fillText #26a69a a1 [308.4,245.5,308.4,245.5] "RR 2.00"@308.4,245.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,255,85,275]
stroke #ff9800 a1 [65,255,85,275]
stroke #ff9800 a1 [72.6,262.6,77.4,267.4]
fill #121923 a1 [91,255,224,275]
stroke #ff9800 a1 [91,255,224,275]
fill #ff9800 a1 [99,250,107,255]
fillText #ff9800 a1 [98,265.5,98,265.5] "⋮⋮  SL −20.00 USD"@98,265.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,195,85,215]
stroke #3aaeff a1 [65,195,85,215]
stroke #3aaeff a1 [72.6,202.6,77.4,207.4]
fill #121923 a1 [91,195,224,215]
stroke #3aaeff a1 [91,195,224,215]
fill #3aaeff a1 [99,215,107,220]
fillText #3aaeff a1 [98,205.5,98,205.5] "⋮⋮  TP +40.00 USD"@98,205.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "entry",
   "x": 65,
   "y": 235,
   "w": 299.4,
   "h": 20,
   "lineY": 245
  },
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "sl",
   "x": 65,
   "y": 255,
   "w": 159,
   "h": 20,
   "lineY": 265
  },
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "tp",
   "x": 65,
   "y": 195,
   "w": 159,
   "h": 20,
   "lineY": 205
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-buy",
   "y": 265
  }
 ],
 "tpLines": [
  {
   "id": "pos-buy",
   "y": 205
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 245,
   "r": 10
  }
 ],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 265,
   "r": 10
  }
 ],
 "tpClears": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 205,
   "r": 10
  }
 ]
}`,
  },
  'sell position with only SL / lines': {
    ops: `clip a1 [41,45,641,445]
fillRect #ff7185 a0.12 [41,225,641,245]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-sell",
   "y": 225
  }
 ],
 "tpLines": [],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'sell position with only SL / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #f7525f a1 [65,235,85,255]
stroke #f7525f a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [91,235,294.2,255]
stroke #f7525f a1 [91,235,294.2,255]
fill #f7525f a1 [99,255,107,260]
fillText #f7525f a1 [98,245.5,98,245.5] "⋮⋮  P&L "@98,245.5 400 12px system-ui, sans-serif
fillText #f7525f a1 [217,245.5,217,245.5] "−6.63 USD"@217,245.5 400 12px system-ui, sans-serif
fillText #f7525f a1 [217,245.5,217,245.5] ""@217,245.5 400 12px system-ui, sans-serif
fill #f7525f a1 [224,241.9,231.2,249.1]
fillText #f7525f a1 [238.2,245.5,238.2,245.5] "3 units"@238.2,245.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,215,85,235]
stroke #ff9800 a1 [65,215,85,235]
stroke #ff9800 a1 [72.6,222.6,77.4,227.4]
fill #121923 a1 [91,215,224,235]
stroke #ff9800 a1 [91,215,224,235]
fill #ff9800 a1 [99,235,107,240]
fillText #ff9800 a1 [98,225.5,98,225.5] "⋮⋮  SL −15.00 USD"@98,225.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,267,147,287]
stroke #3aaeff a1 [91,267,147,287]
fill #3aaeff a1 [99,262,107,267]
fillText #3aaeff a1 [98,277.5,98,277.5] "⋮⋮  TP"@98,277.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "pos-sell",
   "level": "entry",
   "x": 65,
   "y": 235,
   "w": 229.2,
   "h": 20,
   "lineY": 245
  },
  {
   "source": "trading",
   "id": "pos-sell",
   "level": "sl",
   "x": 65,
   "y": 215,
   "w": 159,
   "h": 20,
   "lineY": 225
  },
  {
   "source": "trading",
   "id": "pos-sell",
   "level": "tp",
   "x": 91,
   "y": 267,
   "w": 56,
   "h": 20,
   "lineY": 277
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-sell",
   "y": 225
  }
 ],
 "tpLines": [],
 "slHandles": [],
 "tpHandles": [
  {
   "id": "pos-sell",
   "x": 91,
   "y": 267,
   "w": 56,
   "h": 20
  }
 ],
 "posCloses": [
  {
   "id": "pos-sell",
   "x": 75,
   "y": 245,
   "r": 10
  }
 ],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [
  {
   "id": "pos-sell",
   "x": 75,
   "y": 225,
   "r": 10
  }
 ],
 "tpClears": []
}`,
  },
  'partial close available and no P&L yet / lines': {
    ops: `clip a1 [41,45,641,445]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [],
 "tpLines": [],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'partial close available and no P&L yet / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #26a69a a1 [65,235,85,255]
stroke #26a69a a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [87,235,107,255]
stroke #26a69a a1 [87,235,107,255]
stroke #26a69a a1 [93.8,243.6,100.2,247]
fill #121923 a1 [113,235,316.2,255]
stroke #26a69a a1 [113,235,316.2,255]
fill #26a69a a1 [121,230,129,235]
fillText #26a69a a1 [120,245.5,120,245.5] "⋮⋮  P&L "@120,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [239,245.5,239,245.5] "+2.00 USD"@239,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [239,245.5,239,245.5] ""@239,245.5 400 12px system-ui, sans-serif
fill #26a69a a1 [246,241.9,253.2,249.1]
fillText #26a69a a1 [260.2,245.5,260.2,245.5] "1 units"@260.2,245.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,267,147,287]
stroke #ff9800 a1 [91,267,147,287]
fill #ff9800 a1 [99,262,107,267]
fillText #ff9800 a1 [98,277.5,98,277.5] "⋮⋮  SL"@98,277.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,203,147,223]
stroke #3aaeff a1 [91,203,147,223]
fill #3aaeff a1 [99,223,107,228]
fillText #3aaeff a1 [98,213.5,98,213.5] "⋮⋮  TP"@98,213.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,315,85,335]
stroke #f7525f a1 [65,315,85,335]
stroke #f7525f a1 [72.6,322.6,77.4,327.4]
clip a1 [41,45,641,445]
fill #121923 a1 [91,283,147,303]
stroke #ff9800 a1 [91,283,147,303]
fill #ff9800 a1 [99,303,107,308]
fillText #ff9800 a1 [98,293.5,98,293.5] "⋮⋮  SL"@98,293.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,347,147,367]
stroke #3aaeff a1 [91,347,147,367]
fill #3aaeff a1 [99,342,107,347]
fillText #3aaeff a1 [98,357.5,98,357.5] "⋮⋮  TP"@98,357.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "pos-partial",
   "level": "entry",
   "x": 65,
   "y": 235,
   "w": 251.2,
   "h": 20,
   "lineY": 245
  },
  {
   "source": "trading",
   "id": "pos-partial",
   "level": "sl",
   "x": 91,
   "y": 267,
   "w": 56,
   "h": 20,
   "lineY": 277
  },
  {
   "source": "trading",
   "id": "pos-partial",
   "level": "tp",
   "x": 91,
   "y": 203,
   "w": 56,
   "h": 20,
   "lineY": 213
  },
  {
   "source": "trading",
   "id": "pos-fresh",
   "level": "entry",
   "x": 65,
   "y": 315,
   "w": 20,
   "h": 20,
   "lineY": 325
  },
  {
   "source": "trading",
   "id": "pos-fresh",
   "level": "sl",
   "x": 91,
   "y": 283,
   "w": 56,
   "h": 20,
   "lineY": 293
  },
  {
   "source": "trading",
   "id": "pos-fresh",
   "level": "tp",
   "x": 91,
   "y": 347,
   "w": 56,
   "h": 20,
   "lineY": 357
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [],
 "tpLines": [],
 "slHandles": [
  {
   "id": "pos-partial",
   "x": 91,
   "y": 267,
   "w": 56,
   "h": 20
  },
  {
   "id": "pos-fresh",
   "x": 91,
   "y": 283,
   "w": 56,
   "h": 20
  }
 ],
 "tpHandles": [
  {
   "id": "pos-partial",
   "x": 91,
   "y": 203,
   "w": 56,
   "h": 20
  },
  {
   "id": "pos-fresh",
   "x": 91,
   "y": 347,
   "w": 56,
   "h": 20
  }
 ],
 "posCloses": [
  {
   "id": "pos-partial",
   "x": 75,
   "y": 245,
   "r": 10
  },
  {
   "id": "pos-fresh",
   "x": 75,
   "y": 325,
   "r": 10
  }
 ],
 "posPartials": [
  {
   "id": "pos-partial",
   "x": 97,
   "y": 245,
   "r": 10
  }
 ],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'pending limit order with SL and TP / lines': {
    ops: `clip a1 [41,45,641,445]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 285
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 305
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 245
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'pending limit order with SL and TP / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,275,85,295]
stroke #26a69a a1 [65,275,85,295]
stroke #26a69a a1 [72.6,282.6,77.4,287.4]
fill #121923 a1 [91,275,154,295]
stroke #26a69a a1 [91,275,154,295]
fill #26a69a a1 [99,270,107,275]
fillText #26a69a a1 [98,285.5,98,285.5] "⋮⋮  Buy"@98,285.5 400 12px system-ui, sans-serif
fill #121923 a1 [160,275,394,295]
stroke #26a69a a1 [160,275,394,295]
fillText #dce4ef a1 [168,285.5,168,285.5] "⋮⋮  |  2  |  Limit  |  RR 2.00"@168,285.5 600 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,295,85,315]
stroke #ff9800 a1 [65,295,85,315]
stroke #ff9800 a1 [72.6,302.6,77.4,307.4]
fill #121923 a1 [91,295,224,315]
stroke #ff9800 a1 [91,295,224,315]
fill #ff9800 a1 [99,290,107,295]
fillText #ff9800 a1 [98,305.5,98,305.5] "⋮⋮  SL −10.00 USD"@98,305.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #3aaeff a1 [65,235,85,255]
stroke #3aaeff a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [91,235,224,255]
stroke #3aaeff a1 [91,235,224,255]
fill #3aaeff a1 [99,255,107,260]
fillText #3aaeff a1 [98,245.5,98,245.5] "⋮⋮  TP +20.00 USD"@98,245.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "entry",
   "x": 65,
   "y": 275,
   "w": 327,
   "h": 20,
   "lineY": 285
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "sl",
   "x": 65,
   "y": 295,
   "w": 159,
   "h": 20,
   "lineY": 305
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "tp",
   "x": 65,
   "y": 235,
   "w": 159,
   "h": 20,
   "lineY": 245
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 285
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 305
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 245
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [
  {
   "id": "ord-limit",
   "x": 75,
   "y": 285,
   "r": 10
  }
 ],
 "slClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 305,
   "r": 10
  }
 ],
 "tpClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 245,
   "r": 10
  }
 ]
}`,
  },
  'pending stop order without exits / lines': {
    ops: `clip a1 [41,45,641,445]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-stop",
   "y": 205
  }
 ],
 "slLines": [],
 "tpLines": [],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'pending stop order without exits / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,195,85,215]
stroke #f7525f a1 [65,195,85,215]
stroke #f7525f a1 [72.6,202.6,77.4,207.4]
fill #121923 a1 [91,195,161,215]
stroke #f7525f a1 [91,195,161,215]
fill #f7525f a1 [99,215,107,220]
fillText #f7525f a1 [98,205.5,98,205.5] "⋮⋮  Sell"@98,205.5 400 12px system-ui, sans-serif
fill #121923 a1 [167,195,352,215]
stroke #f7525f a1 [167,195,352,215]
fillText #dce4ef a1 [175,205.5,175,205.5] "⋮⋮  |  1  |  Stop Limit"@175,205.5 600 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,163,147,183]
stroke #ff9800 a1 [91,163,147,183]
fill #ff9800 a1 [99,183,107,188]
fillText #ff9800 a1 [98,173.5,98,173.5] "⋮⋮  SL"@98,173.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [91,227,147,247]
stroke #3aaeff a1 [91,227,147,247]
fill #3aaeff a1 [99,222,107,227]
fillText #3aaeff a1 [98,237.5,98,237.5] "⋮⋮  TP"@98,237.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "order:ord-stop",
   "level": "entry",
   "x": 65,
   "y": 195,
   "w": 285,
   "h": 20,
   "lineY": 205
  },
  {
   "source": "trading",
   "id": "order:ord-stop",
   "level": "sl",
   "x": 91,
   "y": 163,
   "w": 56,
   "h": 20,
   "lineY": 173
  },
  {
   "source": "trading",
   "id": "order:ord-stop",
   "level": "tp",
   "x": 91,
   "y": 227,
   "w": 56,
   "h": 20,
   "lineY": 237
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-stop",
   "y": 205
  }
 ],
 "slLines": [],
 "tpLines": [],
 "slHandles": [
  {
   "id": "order:ord-stop",
   "x": 91,
   "y": 163,
   "w": 56,
   "h": 20
  }
 ],
 "tpHandles": [
  {
   "id": "order:ord-stop",
   "x": 91,
   "y": 227,
   "w": 56,
   "h": 20
  }
 ],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [
  {
   "id": "ord-stop",
   "x": 75,
   "y": 205,
   "r": 10
  }
 ],
 "slClears": [],
 "tpClears": []
}`,
  },
  'SL drag preview with money on a position / lines': {
    ops: `clip a1 [41,45,641,445]
fillRect #ff7185 a0.12 [41,245,641,273]
fillRect #6de0ac a0.12 [41,205,641,245]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-buy",
   "y": 273
  }
 ],
 "tpLines": [
  {
   "id": "pos-buy",
   "y": 205
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'SL drag preview with money on a position / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #26a69a a1 [65,235,85,255]
stroke #26a69a a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [91,235,364.4,255]
stroke #26a69a a1 [91,235,364.4,255]
fill #26a69a a1 [99,230,107,235]
fillText #26a69a a1 [98,245.5,98,245.5] "⋮⋮  P&L "@98,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [217,245.5,217,245.5] "+1.04 USD"@217,245.5 400 12px system-ui, sans-serif
fillText #26a69a a1 [217,245.5,217,245.5] ""@217,245.5 400 12px system-ui, sans-serif
fill #26a69a a1 [224,241.9,231.2,249.1]
fillText #26a69a a1 [238.2,245.5,238.2,245.5] "1 units"@238.2,245.5 400 12px system-ui, sans-serif
fill #26a69a a1 [294.2,241.9,301.40000000000003,249.1]
fillText #26a69a a1 [308.4,245.5,308.4,245.5] "RR 1.43"@308.4,245.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,263,85,283]
stroke #ff9800 a1 [65,263,85,283]
stroke #ff9800 a1 [72.6,270.6,77.4,275.4]
fill #121923 a1 [91,263,224,283]
stroke #ff9800 a1 [91,263,224,283]
fill #ff9800 a1 [99,258,107,263]
fillText #ff9800 a1 [98,273.5,98,273.5] "⋮⋮  SL −28.00 USD"@98,273.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,195,85,215]
stroke #3aaeff a1 [65,195,85,215]
stroke #3aaeff a1 [72.6,202.6,77.4,207.4]
fill #121923 a1 [91,195,224,215]
stroke #3aaeff a1 [91,195,224,215]
fill #3aaeff a1 [99,215,107,220]
fillText #3aaeff a1 [98,205.5,98,205.5] "⋮⋮  TP +40.00 USD"@98,205.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "entry",
   "x": 65,
   "y": 235,
   "w": 299.4,
   "h": 20,
   "lineY": 245
  },
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "sl",
   "x": 65,
   "y": 263,
   "w": 159,
   "h": 20,
   "lineY": 273
  },
  {
   "source": "trading",
   "id": "pos-buy",
   "level": "tp",
   "x": 65,
   "y": 195,
   "w": 159,
   "h": 20,
   "lineY": 205
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [
  {
   "id": "pos-buy",
   "y": 273
  }
 ],
 "tpLines": [
  {
   "id": "pos-buy",
   "y": 205
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 245,
   "r": 10
  }
 ],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 273,
   "r": 10
  }
 ],
 "tpClears": [
  {
   "id": "pos-buy",
   "x": 75,
   "y": 205,
   "r": 10
  }
 ]
}`,
  },
  'TP drag with money on an order / lines': {
    ops: `clip a1 [41,45,641,445]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 285
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 305
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 237
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'TP drag with money on an order / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,275,85,295]
stroke #26a69a a1 [65,275,85,295]
stroke #26a69a a1 [72.6,282.6,77.4,287.4]
fill #121923 a1 [91,275,154,295]
stroke #26a69a a1 [91,275,154,295]
fill #26a69a a1 [99,270,107,275]
fillText #26a69a a1 [98,285.5,98,285.5] "⋮⋮  Buy"@98,285.5 400 12px system-ui, sans-serif
fill #121923 a1 [160,275,394,295]
stroke #26a69a a1 [160,275,394,295]
fillText #dce4ef a1 [168,285.5,168,285.5] "⋮⋮  |  2  |  Limit  |  RR 2.40"@168,285.5 600 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,295,85,315]
stroke #ff9800 a1 [65,295,85,315]
stroke #ff9800 a1 [72.6,302.6,77.4,307.4]
fill #121923 a1 [91,295,224,315]
stroke #ff9800 a1 [91,295,224,315]
fill #ff9800 a1 [99,290,107,295]
fillText #ff9800 a1 [98,305.5,98,305.5] "⋮⋮  SL −10.00 USD"@98,305.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,227,85,247]
stroke #3aaeff a1 [65,227,85,247]
stroke #3aaeff a1 [72.6,234.6,77.4,239.4]
fill #121923 a1 [91,227,224,247]
stroke #3aaeff a1 [91,227,224,247]
fill #3aaeff a1 [99,247,107,252]
fillText #3aaeff a1 [98,237.5,98,237.5] "⋮⋮  TP +24.00 USD"@98,237.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "entry",
   "x": 65,
   "y": 275,
   "w": 327,
   "h": 20,
   "lineY": 285
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "sl",
   "x": 65,
   "y": 295,
   "w": 159,
   "h": 20,
   "lineY": 305
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "tp",
   "x": 65,
   "y": 227,
   "w": 159,
   "h": 20,
   "lineY": 237
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 285
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 305
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 237
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [
  {
   "id": "ord-limit",
   "x": 75,
   "y": 285,
   "r": 10
  }
 ],
 "slClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 305,
   "r": 10
  }
 ],
 "tpClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 237,
   "r": 10
  }
 ]
}`,
  },
  'order line drag with exit preview / lines': {
    ops: `clip a1 [41,45,641,445]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 281
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 301
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 241
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'order line drag with exit preview / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,271,85,291]
stroke #26a69a a1 [65,271,85,291]
stroke #26a69a a1 [72.6,278.6,77.4,283.4]
fill #121923 a1 [91,271,154,291]
stroke #26a69a a1 [91,271,154,291]
fill #26a69a a1 [99,266,107,271]
fillText #26a69a a1 [98,281.5,98,281.5] "⋮⋮  Buy"@98,281.5 400 12px system-ui, sans-serif
fill #121923 a1 [160,271,394,291]
stroke #26a69a a1 [160,271,394,291]
fillText #dce4ef a1 [168,281.5,168,281.5] "⋮⋮  |  2  |  Limit  |  RR 2.00"@168,281.5 600 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,291,85,311]
stroke #ff9800 a1 [65,291,85,311]
stroke #ff9800 a1 [72.6,298.6,77.4,303.4]
fill #121923 a1 [91,291,224,311]
stroke #ff9800 a1 [91,291,224,311]
fill #ff9800 a1 [99,286,107,291]
fillText #ff9800 a1 [98,301.5,98,301.5] "⋮⋮  SL −10.00 USD"@98,301.5 400 12px system-ui, sans-serif
clip a1 [41,45,641,445]
fill #121923 a1 [65,231,85,251]
stroke #3aaeff a1 [65,231,85,251]
stroke #3aaeff a1 [72.6,238.6,77.4,243.4]
fill #121923 a1 [91,231,224,251]
stroke #3aaeff a1 [91,231,224,251]
fill #3aaeff a1 [99,251,107,256]
fillText #3aaeff a1 [98,241.5,98,241.5] "⋮⋮  TP +20.00 USD"@98,241.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "entry",
   "x": 65,
   "y": 271,
   "w": 327,
   "h": 20,
   "lineY": 281
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "sl",
   "x": 65,
   "y": 291,
   "w": 159,
   "h": 20,
   "lineY": 301
  },
  {
   "source": "trading",
   "id": "order:ord-limit",
   "level": "tp",
   "x": 65,
   "y": 231,
   "w": 159,
   "h": 20,
   "lineY": 241
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [
  {
   "id": "ord-limit",
   "y": 281
  }
 ],
 "slLines": [
  {
   "id": "order:ord-limit",
   "y": 301
  }
 ],
 "tpLines": [
  {
   "id": "order:ord-limit",
   "y": 241
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [
  {
   "id": "ord-limit",
   "x": 75,
   "y": 281,
   "r": 10
  }
 ],
 "slClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 301,
   "r": 10
  }
 ],
 "tpClears": [
  {
   "id": "order:ord-limit",
   "x": 75,
   "y": 241,
   "r": 10
  }
 ]
}`,
  },
  'entry outside the pane while exits are inside / lines': {
    ops: `clip a1 [41,45,641,445]
fillRect #6de0ac a0.12 [41,245,641,485.00000000000006]`,
    hit: `{
 "labels": [],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [],
 "tpLines": [
  {
   "id": "pos-low",
   "y": 245
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": []
}`,
  },
  'entry outside the pane while exits are inside / labels': {
    ops: `clip a1 [41,45,641,445]
clip a1 [41,45,641,445]
fill #121923 a1 [65,235,85,255]
stroke #3aaeff a1 [65,235,85,255]
stroke #3aaeff a1 [72.6,242.6,77.4,247.4]
fill #121923 a1 [91,235,147,255]
stroke #3aaeff a1 [91,235,147,255]
fill #3aaeff a1 [99,255,107,260]
fillText #3aaeff a1 [98,245.5,98,245.5] "⋮⋮  TP"@98,245.5 400 12px system-ui, sans-serif`,
    hit: `{
 "labels": [
  {
   "source": "trading",
   "id": "pos-low",
   "level": "tp",
   "x": 65,
   "y": 235,
   "w": 82,
   "h": 20,
   "lineY": 245
  }
 ],
 "chartRect": {
  "x": 41,
  "y": 45,
  "width": 600,
  "height": 400
 },
 "orderLines": [],
 "slLines": [],
 "tpLines": [
  {
   "id": "pos-low",
   "y": 245
  }
 ],
 "slHandles": [],
 "tpHandles": [],
 "posCloses": [],
 "posPartials": [],
 "orderCancels": [],
 "slClears": [],
 "tpClears": [
  {
   "id": "pos-low",
   "x": 75,
   "y": 245,
   "r": 10
  }
 ]
}`,
  },
};
