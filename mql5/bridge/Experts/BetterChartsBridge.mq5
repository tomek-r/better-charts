//+------------------------------------------------------------------+
//| BetterChartsBridge.mq5                                           |
//| MT5 bridge: market data and guarded trading commands.   |
//+------------------------------------------------------------------+
#property strict
#define BRIDGE_EXPERT_VERSION "1.003"
#property version BRIDGE_EXPERT_VERSION
#property description "Better Charts MT5 bridge: market data and trading commands."

#include <Trade\Trade.mqh>
#include <Generic\HashMap.mqh>

input string InpBridgeHost  = "127.0.0.1";
input ushort InpBridgePort  = 8765;
input string InpBridgeToken = "";
input uint InpBridgeMaxFrameMiB = 8;
input uint InpBridgeMaxTicksPerPage = 65535;

#define BRIDGE_PROTOCOL_VERSION 1
#define BRIDGE_MAX_FRAME        1048576
#define BRIDGE_READ_CHUNK       4096
#define BRIDGE_SEND_CHUNK       65536
// Keep command ingress responsive even when the chart symbol is quiet. MT5
// delivers real-time millisecond timers no faster than roughly 10-16 ms, so
// 20 ms avoids asking Wine for an unattainable cadence while cutting the old
// worst-case polling delay from 100 ms to about 20 ms.
#define BRIDGE_TIMER_MS         20
#define BRIDGE_BAR_FALLBACK_MS  1000
#define BRIDGE_ACCOUNT_POLL_MS  500
#define BRIDGE_PORTFOLIO_POLL_MS 250
#define BRIDGE_CONNECT_TIMEOUT  500
#define BRIDGE_HEARTBEAT_MS     2000
#define BRIDGE_HANDSHAKE_TIMEOUT_MS 3000
// Tick reader result files: page magic, then a fixed 16-byte NUL-padded ASCII
// version, then int error, int count and the ticks. Magic 0x54435031 was the
// unversioned layout and is rejected as an outdated reader.
#define BRIDGE_READER_MAGIC         0x54435032
#define BRIDGE_READER_MAGIC_LEGACY  0x54435031
#define BRIDGE_READER_VERSION_BYTES 16
#define BRIDGE_READER_HEADER_BYTES  28
// The probe resolves on the first timer turns after iCustom initializes the
// reader, so a healthy reader answers within milliseconds. 3 s tolerates a
// slow terminal without delaying the connect noticeably; on expiry the hello
// carries a null version and the app reports the reader as missing.
#define BRIDGE_READER_PROBE_TIMEOUT_MS 3000
#define BRIDGE_IDLE_TIMEOUT_MS  6000

enum BridgeState { BRIDGE_DISCONNECTED=0, BRIDGE_CONNECTING=1, BRIDGE_HELLO_SENT=2, BRIDGE_READY=3 };
int g_socket=INVALID_HANDLE;
CTrade g_trade;
BridgeState g_state=BRIDGE_DISCONNECTED;
uchar g_rx[];
uint g_rx_size=0;
ulong g_next_connect_ms=0, g_connected_ms=0, g_last_rx_ms=0, g_last_heartbeat_ms=0;
ulong g_last_bar_poll_ms=0;
ulong g_last_account_poll_ms=0, g_last_portfolio_poll_ms=0;
int g_backoff_index=0;
bool g_warned_oversize=false;
ulong g_message_id=0;
ulong g_heartbeat_sequence=0;
uint g_max_frame_bytes=BRIDGE_MAX_FRAME;
uint g_max_ticks_per_page=5000;
// One asynchronous page; newer requests supersede the old worker.
int g_tick_reader=INVALID_HANDLE;
string g_tick_file="",g_tick_request="",g_tick_symbol="";
long g_tick_from=0,g_tick_to=0,g_tick_max=0;
ulong g_tick_started_ms=0,g_tick_attempt_ms=0,g_tick_job_sequence=0;
MqlTick g_tick_page[];
string g_tick_header="";
uchar g_tick_payload[];
int g_tick_payload_size=0;
int g_tick_cursor=0,g_tick_emitted=0,g_tick_bytes=0,g_tick_budget=0;
bool g_tick_complete=false;
bool g_price_counts_enabled=false,g_tick_aggregate=false;
struct TickPriceCounter { string price; uint total,bid,ask; bool bid_seen; };
CHashMap<string,int> g_price_index;
TickPriceCounter g_prices[];
int g_price_count=0,g_price_cursor=0,g_tick_accepted=0;
long g_tick_through=0;
uint g_tick_rejected=0;
double g_tick_min_quote=0,g_tick_max_quote=0;
ulong g_tick_reader_ready_ms=0;
ulong g_trade_sequence=0;
// One-shot reader version probe run before each connect. Empty = unknown.
int g_probe_reader=INVALID_HANDLE;
string g_probe_file="";
ulong g_probe_started_ms=0;
bool g_probe_active=false,g_probe_done=false;
string g_reader_version="";
string g_session_id="";
bool g_history_ready=false;
MqlRates g_last_bar;
bool g_have_last_bar=false;
MqlTick g_last_quote;
bool g_have_last_quote=false;
string g_active_symbol="";
string g_active_timeframe_name="";
ENUM_TIMEFRAMES g_active_timeframe=PERIOD_M1;
string g_identity_login="";
string g_identity_server="";
string g_last_account_payload="";
bool g_have_account_snapshot=false;
string g_last_portfolio_payload="";
bool g_have_portfolio_snapshot=false;

#define BRIDGE_COMMAND_QUEUE_MAX      32
#define BRIDGE_COMMAND_REGISTRY_MAX   512
#define BRIDGE_COMMAND_ACK_TIMEOUT_MS 10000
// Keep the legacy filename so renaming the EA preserves command recovery.
#define BRIDGE_COMMAND_JOURNAL        "TradeCanvasBridge.commands.log"

// Last known durable state of one trading command (idempotency registry).
struct BridgeCommandRecord
  {
   string command_id;
   string payload_hash;
   string status;
   long   at_update;
   long   retcode;
   long   last_error;
   string broker_order_id;
   string deal_id;
   string position_id;
   string filled_volume;
   string message;
   long   updated_at_ms;
  };

// One validated inbound execution request waiting in the sequential queue.
struct BridgeCommandRequest
  {
   string kind;
   string command_id;
   string payload_hash;
   string draft_id;
   string account_login;
   string broker_server;
   string symbol;
   string side;
   string order_kind;
   string volume;
   string entry;
   string stop_loss;
   string take_profit;
   // bridge-v1 additive extension: absent fields mean gtc / no limit_price.
   string time_in_force;
   string limit_price;
   string target_kind;
   string target_id;
   string price;
   string position_id;
   string order_id;
  };

BridgeCommandRecord g_commands[];
BridgeCommandRequest g_queue[BRIDGE_COMMAND_QUEUE_MAX];
int g_queue_count=0;
bool g_inflight=false;
string g_inflight_id="";
ulong g_inflight_since_ms=0;
string g_watch_id="";
string g_watch_kind="";
string g_watch_symbol="";
ulong g_watch_order=0;
ulong g_watch_position=0;
double g_watch_volume=0.0;
double g_watch_filled=0.0;

int BackoffSeconds(const int index)
  {
   if(index<=0) return 1;
   if(index==1) return 2;
   if(index==2) return 4;
   if(index==3) return 8;
   return 10;
  }

void ScheduleReconnect()
  {
   const int seconds=BackoffSeconds(g_backoff_index);
   if(g_backoff_index<4) g_backoff_index++;
   g_next_connect_ms=GetTickCount64()+(ulong)seconds*1000;
  }

void CloseConnection()
  {
   CancelTickHistory();
   if(g_socket!=INVALID_HANDLE)
     {
      SocketClose(g_socket);
      g_socket=INVALID_HANDLE;
     }
   g_state=BRIDGE_DISCONNECTED;
   g_rx_size=0;
   ArrayResize(g_rx,0);
  }

void DisconnectAndRetry(const string reason)
  {
   if(reason!="") PrintFormat("BetterChartsBridge disconnected: %s",reason);
   CloseConnection();
   ScheduleReconnect();
  }

bool Utf8Bytes(const string text,uchar &bytes[])
  {
   const int count=StringToCharArray(text,bytes,0,WHOLE_ARRAY,CP_UTF8);
   if(count<=0) return false;
   if(bytes[count-1]==0) ArrayResize(bytes,count-1);
   return ArraySize(bytes)>0;
  }

string JsonEscape(const string text)
  {
   string out="";
   const int length=StringLen(text);
   for(int i=0;i<length;i++)
     {
      const ushort c=StringGetCharacter(text,i);
      if(c==34) out+="\\\"";
      else if(c==92) out+="\\\\";
      else if(c==10) out+="\\n";
      else if(c==13) out+="\\r";
      else if(c==9) out+="\\t";
      else if(c<32) out+=StringFormat("\\u%04X",c);
      else out+=ShortToString(c);
     }
   return out;
  }

bool SendPayloadBytes(const uchar &payload[],const int payload_size)
  {
   if(payload_size<=0 || payload_size>(int)g_max_frame_bytes || payload_size>ArraySize(payload)) return false;
   uchar frame[];
   ArrayResize(frame,payload_size+4);
   frame[0]=(uchar)((payload_size>>24)&0xff);
   frame[1]=(uchar)((payload_size>>16)&0xff);
   frame[2]=(uchar)((payload_size>>8)&0xff);
   frame[3]=(uchar)(payload_size&0xff);
   ArrayCopy(frame,payload,4,0,payload_size);
   const int frame_size=ArraySize(frame);
   // A local TCP write normally accepts the whole frame. Send the original
   // buffer first and allocate/copy a remainder only for a partial write.
   int sent=SocketSend(g_socket,frame,frame_size);
   if(sent<=0) return false;
   uchar part[];
   while(sent<frame_size)
     {
      int length=frame_size-sent;
      if(length>BRIDGE_SEND_CHUNK) length=BRIDGE_SEND_CHUNK;
      ArrayResize(part,length);
      ArrayCopy(part,frame,0,sent,length);
      const int n=SocketSend(g_socket,part,length);
      if(n<=0) return false;
      sent+=n;
     }
   return true;
  }

bool SendFrame(const string json)
  {
   uchar payload[];
   if(!Utf8Bytes(json,payload)) return false;
   return SendPayloadBytes(payload,ArraySize(payload));
  }

bool AppendReceived(const uchar &chunk[],const int count)
  {
   if(count<=0) return true;
   if(g_rx_size+(uint)count>g_max_frame_bytes+4) return false;
   ArrayResize(g_rx,(int)(g_rx_size+(uint)count));
   ArrayCopy(g_rx,chunk,(int)g_rx_size,0,count);
   g_rx_size+=(uint)count;
   return true;
  }

uint FrameLength()
  { return ((uint)g_rx[0]<<24)|((uint)g_rx[1]<<16)|((uint)g_rx[2]<<8)|(uint)g_rx[3]; }

bool TakeFrame(string &json)
  {
   json="";
   if(g_rx_size<4) return false;
   const uint length=FrameLength();
   if(length==0)
     {
      Print("BetterChartsBridge rejected zero-length frame");
      return false;
     }
   if(length>g_max_frame_bytes)
     {
      if(!g_warned_oversize) Print("BetterChartsBridge rejected oversized frame");
      g_warned_oversize=true;
      return false;
     }
   if(g_rx_size<length+4) return false;
   uchar payload[];
   ArrayResize(payload,(int)length);
   if(length>0) ArrayCopy(payload,g_rx,0,4,(int)length);
   json=CharArrayToString(payload,0,(int)length,CP_UTF8);
   const uint remaining=g_rx_size-length-4;
   if(remaining>0) ArrayCopy(g_rx,g_rx,0,(int)(length+4),(int)remaining);
   g_rx_size=remaining;
   ArrayResize(g_rx,(int)remaining);
   return true;
  }

string ControlType(const string json)
  {
   if(StringFind(json,"\"type\":\"hello_ack\"")>=0 || StringFind(json,"\"type\": \"hello_ack\"")>=0) return "hello_ack";
   if(StringFind(json,"\"type\":\"heartbeat_ack\"")>=0 || StringFind(json,"\"type\": \"heartbeat_ack\"")>=0) return "heartbeat_ack";
   if(StringFind(json,"\"type\":\"history_request\"")>=0 || StringFind(json,"\"type\": \"history_request\"")>=0) return "history_request";
   if(StringFind(json,"\"type\":\"tick_history_request\"")>=0 || StringFind(json,"\"type\": \"tick_history_request\"")>=0) return "tick_history_request";
   if(StringFind(json,"\"type\":\"symbol_search_request\"")>=0 || StringFind(json,"\"type\": \"symbol_search_request\"")>=0) return "symbol_search_request";
   if(StringFind(json,"\"type\":\"symbol_info_request\"")>=0 || StringFind(json,"\"type\": \"symbol_info_request\"")>=0) return "symbol_info_request";
   if(StringFind(json,"\"type\":\"risk_quote_request\"")>=0 || StringFind(json,"\"type\": \"risk_quote_request\"")>=0) return "risk_quote_request";
   if(StringFind(json,"\"type\":\"order_check_request\"")>=0 || StringFind(json,"\"type\": \"order_check_request\"")>=0) return "order_check_request";
   if(StringFind(json,"\"type\":\"reconcile_request\"")>=0 || StringFind(json,"\"type\": \"reconcile_request\"")>=0) return "reconcile_request";
   if(StringFind(json,"\"type\":\"order_submit_request\"")>=0 || StringFind(json,"\"type\": \"order_submit_request\"")>=0) return "order_submit_request";
   if(StringFind(json,"\"type\":\"order_modify_request\"")>=0 || StringFind(json,"\"type\": \"order_modify_request\"")>=0) return "order_modify_request";
   if(StringFind(json,"\"type\":\"order_close_request\"")>=0 || StringFind(json,"\"type\": \"order_close_request\"")>=0) return "order_close_request";
   if(StringFind(json,"\"type\":\"order_cancel_request\"")>=0 || StringFind(json,"\"type\": \"order_cancel_request\"")>=0) return "order_cancel_request";
   if(StringFind(json,"\"type\":\"error\"")>=0 || StringFind(json,"\"type\": \"error\"")>=0) return "error";
   return "";
  }

string JsonStringField(const string json,const string field)
  {
   string marker="\""+field+"\":\"";
   int start=StringFind(json,marker);
   if(start<0)
     {
      marker="\""+field+"\": \"";
      start=StringFind(json,marker);
     }
   if(start<0)
     {
      marker="\""+field+"\" : \"";
      start=StringFind(json,marker);
     }
   if(start<0) return "";
   const int value_start=start+StringLen(marker);
   const int end=StringFind(json,"\"",value_start);
   if(end<0) return "";
   return StringSubstr(json,value_start,end-value_start);
  }

long JsonIntegerField(const string json,const string field,const long fallback)
  {
   string marker="\""+field+"\":";
   int start=StringFind(json,marker);
   if(start<0)
     {
      marker="\""+field+"\": ";
      start=StringFind(json,marker);
     }
   if(start<0) return fallback;
   const int value_start=start+StringLen(marker);
   int end=value_start;
   while(end<StringLen(json))
     {
      const ushort c=StringGetCharacter(json,end);
      if(c<'0' || c>'9') break;
      end++;
     }
   if(end==value_start) return fallback;
   return StringToInteger(StringSubstr(json,value_start,end-value_start));
  }

// MT5's standard periods, shared by parsing and capability advertisement.
ENUM_TIMEFRAMES g_supported_timeframes[]={
   PERIOD_M1,PERIOD_M2,PERIOD_M3,PERIOD_M4,PERIOD_M5,PERIOD_M6,
   PERIOD_M10,PERIOD_M12,PERIOD_M15,PERIOD_M20,PERIOD_M30,
   PERIOD_H1,PERIOD_H2,PERIOD_H3,PERIOD_H4,PERIOD_H6,PERIOD_H8,PERIOD_H12,
   PERIOD_D1,PERIOD_W1,PERIOD_MN1
};

bool ParseTimeframe(const string name,ENUM_TIMEFRAMES &timeframe)
  {
   for(int i=0;i<ArraySize(g_supported_timeframes);i++)
     {
      const ENUM_TIMEFRAMES period=g_supported_timeframes[i];
      if(name==StringSubstr(EnumToString(period),7))
        {
         timeframe=period;
         return true;
        }
     }
   return false;
  }

string SupportedTimeframesJson()
  {
   string result="[";
   for(int i=0;i<ArraySize(g_supported_timeframes);i++)
     {
      if(i>0) result+=",";
      result+="\""+StringSubstr(EnumToString(g_supported_timeframes[i]),7)+"\"";
     }
   return result+"]";
  }

// Advertise the same permission snapshot used when accepting and dispatching orders.
bool TradingEnabled()
  {
   return TerminalInfoInteger(TERMINAL_CONNECTED)!=0 &&
          TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)!=0 &&
          MQLInfoInteger(MQL_TRADE_ALLOWED)!=0 &&
          AccountInfoInteger(ACCOUNT_LOGIN)!=0 &&
          AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)!=0 &&
          AccountInfoInteger(ACCOUNT_TRADE_EXPERT)!=0;
  }

// One weekday row of `SymbolInfoSessionTrade`, checked against `offset`
// seconds from that row's midnight. Rows may cross midnight: the terminal
// shifts `to` into the next day (e.g. 22:00-03:00 => to = 97200), and the
// defensive `end<=start` branch tolerates a terminal that omits the shift.
bool SessionRowOpen(const string symbol,const ENUM_DAY_OF_WEEK day,const ulong offset)
  {
   datetime from=0,to=0;
   for(uint index=0;index<16;index++)
     {
      if(!SymbolInfoSessionTrade(symbol,day,index,from,to)) break;
      const ulong start=(ulong)from;
      ulong end=(ulong)to;
      if(end<=start) end+=86400;
      if(offset>=start && offset<end) return true;
     }
   return false;
  }

// Broker trade-session check for one symbol at the current server time. The
// current weekday is checked with the elapsed seconds since midnight; the
// previous weekday is checked with a day added, so an overnight session that
// started before midnight still counts. `SYMBOL_TRADE_MODE_DISABLED` closes
// the symbol outright (holidays/unscheduled closures). Uses TimeTradeServer()
// — TimeCurrent() is the last quote time and stops advancing when closed.
bool MarketSessionOpen(const string symbol)
  {
   if(symbol=="" || SymbolInfoInteger(symbol,SYMBOL_EXIST)==0) return false;
   if(SymbolInfoInteger(symbol,SYMBOL_TRADE_MODE)==SYMBOL_TRADE_MODE_DISABLED) return false;
   MqlDateTime parts;
   const datetime server_time=TimeTradeServer();
   if(!TimeToStruct(server_time,parts)) return false;
   const ulong since_midnight=(ulong)server_time%86400;
   const ENUM_DAY_OF_WEEK today=(ENUM_DAY_OF_WEEK)parts.day_of_week;
   if(SessionRowOpen(symbol,today,since_midnight)) return true;
   const ENUM_DAY_OF_WEEK previous=(ENUM_DAY_OF_WEEK)((parts.day_of_week+6)%7);
   return SessionRowOpen(symbol,previous,since_midnight+86400);
  }

// Heartbeat `market_session` fragment for the active symbol; `null` until a
// symbol is selected, so Rust fails closed instead of trusting no data.
string MarketSessionJson()
  {
   if(g_active_symbol=="") return "null";
   const long trade_mode=SymbolInfoInteger(g_active_symbol,SYMBOL_TRADE_MODE);
   const bool is_open=(trade_mode!=SYMBOL_TRADE_MODE_DISABLED && MarketSessionOpen(g_active_symbol));
   return StringFormat("{\"symbol\":\"%s\",\"is_open\":%s,\"trade_mode\":%I64d,\"server_time_ms\":%I64d}",
                       JsonEscape(g_active_symbol),(is_open?"true":"false"),trade_mode,(long)TimeTradeServer()*1000);
  }

bool SendHello()
  {
   g_message_id++;
   const string terminal_id=JsonEscape(TerminalInfoString(TERMINAL_DATA_PATH));
   const string terminal_build=IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   const string account_login=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   const string broker_server=JsonEscape(AccountInfoString(ACCOUNT_SERVER));
   g_identity_login=account_login;
   g_identity_server=AccountInfoString(ACCOUNT_SERVER);
   string hello=StringFormat("{\"v\":%d,\"type\":\"hello\",\"id\":\"ea-%I64u\",\"session_id\":null,\"sent_at_ms\":%I64u,\"payload\":{\"token\":\"%s\",\"terminal_id\":\"%s\",\"terminal_build\":%s,\"account_login\":\"%s\",\"broker_server\":\"%s\",\"chart_symbol\":\"%s\",\"expert_version\":\"%s\",\"tick_reader_version\":%s,\"tick_price_counts\":true,\"supported_timeframes\":%s,\"trading_enabled\":%s,\"transfer_limits\":{\"max_frame_bytes\":%u,\"max_ticks_per_page\":%u}}}",BRIDGE_PROTOCOL_VERSION,g_message_id,(ulong)TimeGMT()*1000,JsonEscape(InpBridgeToken),terminal_id,terminal_build,account_login,broker_server,JsonEscape(_Symbol),BRIDGE_EXPERT_VERSION,(g_reader_version=="" ? "null" : "\""+g_reader_version+"\""),SupportedTimeframesJson(),(TradingEnabled() ? "true" : "false"),InpBridgeMaxFrameMiB*1048576,InpBridgeMaxTicksPerPage);
   return SendFrame(hello);
  }

string AccountPayload()
  {
   const int currency_digits=(int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   const int amount_digits=(currency_digits>=0 && currency_digits<=8 ? currency_digits : 2);
   const double margin=AccountInfoDouble(ACCOUNT_MARGIN);
   double margin_level=(margin>0.0 ? AccountInfoDouble(ACCOUNT_MARGIN_LEVEL) : 0.0);
   if(!MathIsValidNumber(margin_level)) margin_level=0.0;
   // Account trade mode (demo/contest/real): raw ENUM_ACCOUNT_TRADE_MODE
   // value plus its name; an unrecognized value reports "unknown".
   const long trade_mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string trade_mode_name="unknown";
   if(trade_mode==ACCOUNT_TRADE_MODE_DEMO) trade_mode_name="demo";
   else if(trade_mode==ACCOUNT_TRADE_MODE_CONTEST) trade_mode_name="contest";
   else if(trade_mode==ACCOUNT_TRADE_MODE_REAL) trade_mode_name="real";
   return StringFormat("{\"account_login\":\"%s\",\"broker_server\":\"%s\",\"currency\":\"%s\",\"currency_digits\":%d,\"balance\":\"%s\",\"equity\":\"%s\",\"margin\":\"%s\",\"free_margin\":\"%s\",\"margin_level\":\"%s\",\"leverage\":%d,\"margin_mode\":%d,\"trade_allowed\":%s,\"expert_allowed\":%s,\"account_trade_mode\":%I64d,\"account_trade_mode_name\":\"%s\"}",
                       JsonEscape(IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))),JsonEscape(AccountInfoString(ACCOUNT_SERVER)),JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),amount_digits,
                       DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),amount_digits),DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),amount_digits),DoubleToString(margin,amount_digits),DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE),amount_digits),DoubleToString(margin_level,4),
                       AccountInfoInteger(ACCOUNT_LEVERAGE),AccountInfoInteger(ACCOUNT_MARGIN_MODE),(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)!=0?"true":"false"),(AccountInfoInteger(ACCOUNT_TRADE_EXPERT)!=0?"true":"false"),trade_mode,trade_mode_name);
  }

bool PollAccountSnapshot()
  {
   if(g_state!=BRIDGE_READY) return true;
   const string current_login=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   const string current_server=AccountInfoString(ACCOUNT_SERVER);
   if((g_identity_login!="" && current_login!=g_identity_login) || (g_identity_server!="" && current_server!=g_identity_server))
     {
      DisconnectAndRetry("account identity changed");
      return false;
     }
   const string payload=AccountPayload();
   if(g_have_account_snapshot && payload==g_last_account_payload) return true;
   g_message_id++;
   const string snapshot=StringFormat("{\"v\":1,\"type\":\"account_snapshot\",\"id\":\"ea-account-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":%s}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,payload);
   if(!SendFrame(snapshot))
     {
      DisconnectAndRetry("account snapshot send failed");
      return false;
     }
   g_last_account_payload=payload;
   g_have_account_snapshot=true;
   return true;
  }

string NullablePrice(const double value,const int digits)
  { return (value==0.0 ? "null" : "\""+DoubleToString(value,digits)+"\""); }

// Actual position/order volume and entry avoid tiny reference-tick rounding.
// This is a read-only estimate in the account currency, excluding fees/swap.
string ExitProfitJson(const string symbol,const ENUM_ORDER_TYPE side,const double volume,const double entry,const double exit_price)
  {
   double profit=0.0;
   if(volume<=0.0 || entry<=0.0 || exit_price<=0.0 ||
      !OrderCalcProfit(side,symbol,volume,entry,exit_price,profit) || !MathIsValidNumber(profit)) return "null";
   return "\""+DoubleToString(profit,8)+"\"";
  }

string PositionJson()
  {
   const string symbol=PositionGetString(POSITION_SYMBOL);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const long position_id=PositionGetInteger(POSITION_IDENTIFIER);
   const long ticket=PositionGetInteger(POSITION_TICKET);
   const long type=PositionGetInteger(POSITION_TYPE);
   const int currency_digits=(int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   const int amount_digits=(currency_digits>=0 && currency_digits<=8 ? currency_digits : 2);
   const string metadata=StringFormat("{\"position_id\":\"%I64d\",\"ticket\":\"%I64d\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":\"%s\",\"price_open\":\"%s\",\"price_current\":\"%s\",\"stop_loss\":%s,\"take_profit\":%s,\"profit\":\"%s\",\"swap\":\"%s\",\"time_ms\":%I64d,\"magic\":\"%I64d\"}",position_id,ticket,JsonEscape(symbol),(type==POSITION_TYPE_BUY?"buy":"sell"),DoubleToString(PositionGetDouble(POSITION_VOLUME),8),DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),digits),DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT),digits),NullablePrice(PositionGetDouble(POSITION_SL),digits),NullablePrice(PositionGetDouble(POSITION_TP),digits),DoubleToString(PositionGetDouble(POSITION_PROFIT),amount_digits),DoubleToString(PositionGetDouble(POSITION_SWAP),amount_digits),PositionGetInteger(POSITION_TIME_MSC),PositionGetInteger(POSITION_MAGIC));
   const ENUM_ORDER_TYPE side=(type==POSITION_TYPE_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   const double volume=PositionGetDouble(POSITION_VOLUME);
   const double entry=PositionGetDouble(POSITION_PRICE_OPEN);
   return StringSubstr(metadata,0,StringLen(metadata)-1)+",\"stop_loss_profit\":"+
          ExitProfitJson(symbol,side,volume,entry,PositionGetDouble(POSITION_SL))+",\"take_profit_profit\":"+
          ExitProfitJson(symbol,side,volume,entry,PositionGetDouble(POSITION_TP))+"}";
  }

string OrderTypeName(const long type)
  {
   if(type==ORDER_TYPE_BUY_LIMIT) return "buy_limit";
   if(type==ORDER_TYPE_SELL_LIMIT) return "sell_limit";
   if(type==ORDER_TYPE_BUY_STOP) return "buy_stop";
   if(type==ORDER_TYPE_SELL_STOP) return "sell_stop";
   if(type==ORDER_TYPE_BUY_STOP_LIMIT) return "buy_stop_limit";
   if(type==ORDER_TYPE_SELL_STOP_LIMIT) return "sell_stop_limit";
   if(type==ORDER_TYPE_BUY) return "buy";
   if(type==ORDER_TYPE_SELL) return "sell";
   return "unknown";
  }

bool IsPendingOrderType(const long type)
  {
   return type==ORDER_TYPE_BUY_LIMIT || type==ORDER_TYPE_SELL_LIMIT ||
          type==ORDER_TYPE_BUY_STOP || type==ORDER_TYPE_SELL_STOP ||
          type==ORDER_TYPE_BUY_STOP_LIMIT || type==ORDER_TYPE_SELL_STOP_LIMIT;
  }

string OrderStateName(const long state)
  {
   if(state==ORDER_STATE_STARTED) return "started";
   if(state==ORDER_STATE_PLACED) return "placed";
   if(state==ORDER_STATE_CANCELED) return "canceled";
   if(state==ORDER_STATE_PARTIAL) return "partial";
   if(state==ORDER_STATE_FILLED) return "filled";
   if(state==ORDER_STATE_REJECTED) return "rejected";
   if(state==ORDER_STATE_EXPIRED) return "expired";
   return "unknown";
  }

string OrderJson()
  {
   const string symbol=OrderGetString(ORDER_SYMBOL);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const long expiration=OrderGetInteger(ORDER_TIME_EXPIRATION);
   const string metadata=StringFormat("{\"order_id\":\"%I64d\",\"symbol\":\"%s\",\"order_type\":\"%s\",\"state\":\"%s\",\"volume_initial\":\"%s\",\"volume_current\":\"%s\",\"price_open\":\"%s\",\"price_current\":\"%s\",\"stop_loss\":%s,\"take_profit\":%s,\"time_setup_ms\":%I64d,\"expiration_ms\":%s,\"magic\":\"%I64d\"}",OrderGetInteger(ORDER_TICKET),JsonEscape(symbol),OrderTypeName(OrderGetInteger(ORDER_TYPE)),OrderStateName(OrderGetInteger(ORDER_STATE)),DoubleToString(OrderGetDouble(ORDER_VOLUME_INITIAL),8),DoubleToString(OrderGetDouble(ORDER_VOLUME_CURRENT),8),DoubleToString(OrderGetDouble(ORDER_PRICE_OPEN),digits),DoubleToString(OrderGetDouble(ORDER_PRICE_CURRENT),digits),NullablePrice(OrderGetDouble(ORDER_SL),digits),NullablePrice(OrderGetDouble(ORDER_TP),digits),OrderGetInteger(ORDER_TIME_SETUP_MSC),(expiration==0?"null":IntegerToString(expiration*1000)),OrderGetInteger(ORDER_MAGIC));
   const ENUM_ORDER_TYPE side=(StringFind(OrderTypeName(OrderGetInteger(ORDER_TYPE)),"buy_")==0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   const double volume=OrderGetDouble(ORDER_VOLUME_CURRENT);
   const long order_type=OrderGetInteger(ORDER_TYPE);
   const double entry=(order_type==ORDER_TYPE_BUY_STOP_LIMIT || order_type==ORDER_TYPE_SELL_STOP_LIMIT ?
                       OrderGetDouble(ORDER_PRICE_STOPLIMIT) : OrderGetDouble(ORDER_PRICE_OPEN));
   return StringSubstr(metadata,0,StringLen(metadata)-1)+",\"stop_loss_profit\":"+
          ExitProfitJson(symbol,side,volume,entry,OrderGetDouble(ORDER_SL))+",\"take_profit_profit\":"+
          ExitProfitJson(symbol,side,volume,entry,OrderGetDouble(ORDER_TP))+"}";
  }

bool PollPortfolioSnapshot()
  {
   if(g_state!=BRIDGE_READY || !g_have_account_snapshot) return true;
   const string account_login=JsonEscape(IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
   string positions_json="[";
   int emitted=0;
   const int positions=PositionsTotal();
   for(int i=0;i<positions && emitted<500;i++)
     {
      if(PositionGetTicket(i)==0) continue;
      if(emitted>0) positions_json+=",";
      positions_json+=PositionJson();
      emitted++;
     }
   positions_json+="]";
   string orders_json="[";
   int orders_emitted=0;
   const int orders=OrdersTotal();
   for(int i=0;i<orders && orders_emitted<500;i++)
     {
      if(OrderGetTicket(i)==0) continue;
      // Rust accepts only the six pending order types represented here.
      if(!IsPendingOrderType(OrderGetInteger(ORDER_TYPE))) continue;
      if(orders_emitted>0) orders_json+=",";
      orders_json+=OrderJson();
      orders_emitted++;
     }
   orders_json+="]";
   const string stable_body="{\"account_login\":\""+account_login+"\",\"positions\":"+positions_json+",\"orders\":"+orders_json+"}";
   if(g_have_portfolio_snapshot && stable_body==g_last_portfolio_payload) return true;
   const string payload="{\"account_login\":\""+account_login+"\",\"captured_at_ms\":"+IntegerToString((long)TimeGMT()*1000)+",\"positions\":"+positions_json+",\"orders\":"+orders_json+"}";
   g_message_id++;
   const string snapshot=StringFormat("{\"v\":1,\"type\":\"portfolio_snapshot\",\"id\":\"ea-portfolio-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":%s}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,payload);
   if(!SendFrame(snapshot)) return false;
   g_last_portfolio_payload=stable_body;
   g_have_portfolio_snapshot=true;
   return true;
  }

string HistoryDealTypeName(const long type)
  {
   if(type==DEAL_TYPE_BUY) return "buy";
   if(type==DEAL_TYPE_SELL) return "sell";
   if(type==DEAL_TYPE_BALANCE) return "balance";
   if(type==DEAL_TYPE_CREDIT) return "credit";
   if(type==DEAL_TYPE_CHARGE) return "charge";
   if(type==DEAL_TYPE_CORRECTION) return "correction";
   if(type==DEAL_TYPE_BONUS) return "bonus";
   if(type==DEAL_TYPE_COMMISSION) return "commission";
   if(type==DEAL_TYPE_COMMISSION_DAILY) return "commission_daily";
   if(type==DEAL_TYPE_COMMISSION_MONTHLY) return "commission_monthly";
   if(type==DEAL_TYPE_COMMISSION_AGENT_DAILY) return "commission_agent_daily";
   if(type==DEAL_TYPE_COMMISSION_AGENT_MONTHLY) return "commission_agent_monthly";
   if(type==DEAL_TYPE_INTEREST) return "interest";
   if(type==DEAL_TYPE_BUY_CANCELED) return "buy_canceled";
   if(type==DEAL_TYPE_SELL_CANCELED) return "sell_canceled";
   if(type==15) return "dividend";
   if(type==16) return "dividend_franked";
   if(type==17) return "tax";
   return "unknown";
  }

string HistoryDealEntryName(const long entry)
  {
   if(entry==DEAL_ENTRY_IN) return "in";
   if(entry==DEAL_ENTRY_OUT) return "out";
   if(entry==DEAL_ENTRY_INOUT) return "inout";
   if(entry==DEAL_ENTRY_OUT_BY) return "out_by";
   return "unknown";
  }

string OptionalIdJson(const long value)
  { return (value==0?"null":"\""+IntegerToString(value)+"\""); }

string OptionalTextJson(const string value)
  {
   string copy=value;
   StringTrimLeft(copy);
   StringTrimRight(copy);
   if(StringLen(copy)>256) { copy=StringSubstr(copy,0,256); StringTrimLeft(copy); StringTrimRight(copy); }
   return (copy==""?"null":"\""+JsonEscape(copy)+"\"");
  }

bool ReconcileOrderEligible(const ulong ticket,const long history_from_ms,const long history_to_ms)
  {
   if(ticket==0) return false;
   const string symbol=HistoryOrderGetString(ticket,ORDER_SYMBOL);
   const long setup=HistoryOrderGetInteger(ticket,ORDER_TIME_SETUP_MSC);
   const long done=HistoryOrderGetInteger(ticket,ORDER_TIME_DONE_MSC);
   return symbol!="" && done>=setup && done>=history_from_ms && done<=history_to_ms &&
          HistoryOrderGetDouble(ticket,ORDER_VOLUME_INITIAL)>0.0 && HistoryOrderGetDouble(ticket,ORDER_PRICE_OPEN)>0.0;
  }

string HistoryOrderJson(const ulong ticket)
  {
   const string symbol=HistoryOrderGetString(ticket,ORDER_SYMBOL);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const long setup=HistoryOrderGetInteger(ticket,ORDER_TIME_SETUP_MSC);
   const long done=HistoryOrderGetInteger(ticket,ORDER_TIME_DONE_MSC);
   return StringFormat("{\"order_id\":\"%I64u\",\"position_id\":%s,\"time_setup_ms\":%I64d,\"time_done_ms\":%I64d,\"symbol\":\"%s\",\"magic\":\"%I64d\",\"order_type\":\"%s\",\"state\":\"%s\",\"volume_initial\":\"%s\",\"volume_current\":\"%s\",\"price_open\":\"%s\",\"price_current\":\"%s\",\"stop_loss\":%s,\"take_profit\":%s,\"comment\":%s}",ticket,OptionalIdJson(HistoryOrderGetInteger(ticket,ORDER_POSITION_ID)),setup,done,JsonEscape(symbol),HistoryOrderGetInteger(ticket,ORDER_MAGIC),OrderTypeName(HistoryOrderGetInteger(ticket,ORDER_TYPE)),OrderStateName(HistoryOrderGetInteger(ticket,ORDER_STATE)),DoubleToString(HistoryOrderGetDouble(ticket,ORDER_VOLUME_INITIAL),8),DoubleToString(HistoryOrderGetDouble(ticket,ORDER_VOLUME_CURRENT),8),DoubleToString(HistoryOrderGetDouble(ticket,ORDER_PRICE_OPEN),digits),DoubleToString(HistoryOrderGetDouble(ticket,ORDER_PRICE_CURRENT),digits),NullablePrice(HistoryOrderGetDouble(ticket,ORDER_SL),digits),NullablePrice(HistoryOrderGetDouble(ticket,ORDER_TP),digits),OptionalTextJson(HistoryOrderGetString(ticket,ORDER_COMMENT)));
  }

bool ReconcileDealEligible(const ulong ticket,const long history_from_ms,const long history_to_ms)
  {
   if(ticket==0) return false;
   const string symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
   const long order_id=HistoryDealGetInteger(ticket,DEAL_ORDER);
   const long time_ms=HistoryDealGetInteger(ticket,DEAL_TIME_MSC);
   return symbol!="" && order_id>0 && time_ms>=history_from_ms && time_ms<=history_to_ms &&
          HistoryDealGetDouble(ticket,DEAL_VOLUME)>0.0 && HistoryDealGetDouble(ticket,DEAL_PRICE)>0.0;
  }

string HistoryDealJson(const ulong ticket)
  {
   const string symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const int currency_digits=(int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   const int amount_digits=(currency_digits>=0 && currency_digits<=8 ? currency_digits : 2);
   return StringFormat("{\"deal_id\":\"%I64u\",\"order_id\":\"%I64d\",\"position_id\":%s,\"time_ms\":%I64d,\"symbol\":\"%s\",\"magic\":\"%I64d\",\"deal_type\":\"%s\",\"entry\":\"%s\",\"volume\":\"%s\",\"price\":\"%s\",\"profit\":\"%s\",\"commission\":\"%s\",\"swap\":\"%s\",\"fee\":\"%s\",\"comment\":%s}",ticket,HistoryDealGetInteger(ticket,DEAL_ORDER),OptionalIdJson(HistoryDealGetInteger(ticket,DEAL_POSITION_ID)),HistoryDealGetInteger(ticket,DEAL_TIME_MSC),JsonEscape(symbol),HistoryDealGetInteger(ticket,DEAL_MAGIC),HistoryDealTypeName(HistoryDealGetInteger(ticket,DEAL_TYPE)),HistoryDealEntryName(HistoryDealGetInteger(ticket,DEAL_ENTRY)),DoubleToString(HistoryDealGetDouble(ticket,DEAL_VOLUME),8),DoubleToString(HistoryDealGetDouble(ticket,DEAL_PRICE),digits),DoubleToString(HistoryDealGetDouble(ticket,DEAL_PROFIT),amount_digits),DoubleToString(HistoryDealGetDouble(ticket,DEAL_COMMISSION),amount_digits),DoubleToString(HistoryDealGetDouble(ticket,DEAL_SWAP),amount_digits),DoubleToString(HistoryDealGetDouble(ticket,DEAL_FEE),amount_digits),OptionalTextJson(HistoryDealGetString(ticket,DEAL_COMMENT)));
  }

void SendReconcileError(const string request_id,const string code,const string message)
  {
   const string response=StringFormat("{\"v\":1,\"type\":\"reconcile_error\",\"id\":\"ea-reconcile-error-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"code\":\"%s\",\"message\":\"%s\"}}",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(request_id),JsonEscape(code),JsonEscape(message));
   if(!SendFrame(response)) DisconnectAndRetry("reconcile error send failed");
  }

bool SendReconcileSnapshot(const string request_id,const string account_login,const string broker_server,const long history_from_ms,const long max_orders,const long max_deals)
  {
   if(request_id=="" || StringLen(request_id)>128 || account_login=="" || StringLen(account_login)>128 || broker_server=="" || StringLen(broker_server)>128 || history_from_ms<0 || max_orders<1 || max_orders>1000 || max_deals<1 || max_deals>1000)
     { SendReconcileError(request_id,"INVALID_MESSAGE","invalid reconcile request"); return false; }
   if(account_login!=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) || broker_server!=AccountInfoString(ACCOUNT_SERVER))
     { SendReconcileError(request_id,"ACCOUNT_MISMATCH","request account does not match the connected MT5 account"); return false; }
   if(TerminalInfoInteger(TERMINAL_CONNECTED)==0 || account_login=="0")
     { SendReconcileError(request_id,"ACCOUNT_UNAVAILABLE","MT5 account is not connected"); return false; }
   const ulong sequence_before=g_trade_sequence;
   const datetime from_time=(datetime)(history_from_ms/1000);
   const long history_to_ms=(long)TimeCurrent()*1000;
   if(history_from_ms>history_to_ms)
     { SendReconcileError(request_id,"INVALID_MESSAGE","history start is in the future"); return false; }
   if(!HistorySelect(from_time,(datetime)(history_to_ms/1000)))
     { SendReconcileError(request_id,"HISTORY_SELECT_FAILED","MT5 could not select account history"); return false; }

   const int all_orders=HistoryOrdersTotal();
   const int all_deals=HistoryDealsTotal();
   bool history_items_readable=true;
   string history_orders="[";
   int eligible_orders=0;
   for(int i=0;i<all_orders;i++)
     {
      // MT5 enumerates selected history chronologically; reverse iteration emits newest first.
      const ulong ticket=HistoryOrderGetTicket(all_orders-1-i);
      if(ticket==0) { history_items_readable=false; continue; }
      if(!ReconcileOrderEligible(ticket,history_from_ms,history_to_ms)) continue;
      if(eligible_orders>=(int)max_orders) { eligible_orders++; continue; }
      eligible_orders++;
      if(history_orders!="[") history_orders+=",";
      history_orders+=HistoryOrderJson(ticket);
     }
   if(eligible_orders>max_orders) history_items_readable=false;
   history_orders+="]";
   string history_deals="[";
   int eligible_deals=0;
   for(int i=0;i<all_deals;i++)
     {
      const ulong ticket=HistoryDealGetTicket(all_deals-1-i);
      if(ticket==0) { history_items_readable=false; continue; }
      if(!ReconcileDealEligible(ticket,history_from_ms,history_to_ms)) continue;
      if(eligible_deals>=(int)max_deals) { eligible_deals++; continue; }
      eligible_deals++;
      if(history_deals!="[") history_deals+=",";
      history_deals+=HistoryDealJson(ticket);
     }
   if(eligible_deals>max_deals) history_items_readable=false;
   history_deals+="]";

   // Match the established portfolio schema for current positions and pending orders.
   string positions="[";
   int positions_emitted=0;
   const int position_total=PositionsTotal();
   for(int i=0;i<position_total && i<500;i++)
     {
      if(PositionGetTicket(i)==0) continue;
      if(positions_emitted>0) positions+=",";
      positions+=PositionJson();
      positions_emitted++;
     }
   positions+="]";
   string active_orders="[";
   int active_emitted=0;
   const int order_total=OrdersTotal();
   for(int i=0;i<order_total && i<500;i++)
     {
      if(OrderGetTicket(i)==0 || !IsPendingOrderType(OrderGetInteger(ORDER_TYPE))) continue;
      if(active_emitted>0) active_orders+=",";
      active_orders+=OrderJson();
      active_emitted++;
     }
   active_orders+="]";

   const ulong sequence_after=g_trade_sequence;
   long captured_at_ms=(long)TimeCurrent()*1000;
   if(captured_at_ms<history_to_ms) captured_at_ms=history_to_ms;
   const bool complete=(sequence_before==sequence_after && history_items_readable && position_total<=500 && order_total<=500);
   const ulong snapshot_message_id=++g_message_id;
   const string payload=StringFormat("{\"request_id\":\"%s\",\"account_login\":\"%s\",\"broker_server\":\"%s\",\"snapshot_id\":\"ea-reconcile-%I64u\",\"history_from_ms\":%I64d,\"history_to_ms\":%I64d,\"sequence_before\":%I64u,\"sequence_after\":%I64u,\"complete\":%s,\"captured_at_ms\":%I64d,\"positions\":%s,\"active_orders\":%s,\"history_orders\":%s,\"history_deals\":%s}",JsonEscape(request_id),JsonEscape(account_login),JsonEscape(broker_server),snapshot_message_id,history_from_ms,history_to_ms,sequence_before,sequence_after,(complete?"true":"false"),captured_at_ms,positions,active_orders,history_orders,history_deals);
   const string response=StringFormat("{\"v\":1,\"type\":\"reconcile_snapshot\",\"id\":\"ea-reconcile-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":%s}",snapshot_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,payload);
   if(!SendFrame(response)) { SendReconcileError(request_id,"FRAME_TOO_LARGE","reconcile snapshot exceeds frame limit"); return false; }
   return true;
  }

bool EnsureSymbol(const string symbol)
  {
   if(symbol=="" || SymbolInfoInteger(symbol,SYMBOL_EXIST)==0) return false;
   return SymbolSelect(symbol,true);
  }

bool ParsePositiveDecimal(const string text,double &value)
  {
   if(text=="") return false;
   bool has_digit=false;
   int dots=0;
   for(int i=0;i<StringLen(text);i++)
     {
      const ushort c=StringGetCharacter(text,i);
      if(c>='0' && c<='9') { has_digit=true; continue; }
      if(c==46) { dots++; if(dots>1) return false; continue; }
      return false;
     }
   if(!has_digit) return false;
   value=StringToDouble(text);
   return MathIsValidNumber(value) && value>0.0;
  }

// SL/TP level on a modify: same grammar as ParsePositiveDecimal but
// explicitly accepting 0 — the "remove this level" sentinel (MT5 clears a
// stop when PositionModify/OrderModify receives price 0).
bool ParseLevelDecimal(const string text,double &value)
  {
   if(text=="") return false;
   bool has_digit=false;
   int dots=0;
   for(int i=0;i<StringLen(text);i++)
     {
      const ushort c=StringGetCharacter(text,i);
      if(c>='0' && c<='9') { has_digit=true; continue; }
      if(c==46) { dots++; if(dots>1) return false; continue; }
      return false;
     }
   if(!has_digit) return false;
   value=StringToDouble(text);
   return MathIsValidNumber(value) && value>=0.0;
  }

double TickFloor(const double value,const double tick_size,const int digits)
  { return NormalizeDouble(MathFloor(value/tick_size+1e-9)*tick_size,digits); }

double TickCeil(const double value,const double tick_size,const int digits)
  { return NormalizeDouble(MathCeil(value/tick_size-1e-9)*tick_size,digits); }

bool ValidRiskGeometry(const string side,const double entry,const bool has_stop,const double stop_loss,const bool has_take_profit,const double take_profit)
  {
   // Each leg applies only when that level is present (stop_loss is optional
   // on the order paths; the risk preview always passes has_stop=true).
   if(side=="buy") return (!has_stop || stop_loss<entry) && (!has_take_profit || take_profit>entry);
   if(side=="sell") return (!has_stop || stop_loss>entry) && (!has_take_profit || take_profit<entry);
   return false;
  }

// Market exits use fresh quote sides. Pending exits belong to the eventual
// opening price; for Stop Limit that is the resting limit, not the trigger.
bool ValidOrderStopDistances(const string symbol,const string side,const string order_kind,const double geometry_entry,const bool has_stop,const double stop_loss,const bool has_take,const double take_profit,const MqlTick &tick,string &failure)
  {
   const bool is_buy=(side=="buy");
   const bool market=(order_kind=="market");
   const double sl_reference=(market ? (is_buy ? tick.bid : tick.ask) : geometry_entry);
   const double tp_reference=(market ? (is_buy ? tick.ask : tick.bid) : geometry_entry);
   const double point_size=SymbolInfoDouble(symbol,SYMBOL_POINT);
   const double tick_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   const long stops_level=SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL);
   const double minimum=MathMax(stops_level*point_size,20.0*tick_size);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const double sl_distance=(is_buy ? sl_reference-stop_loss : stop_loss-sl_reference);
   const double tp_distance=(is_buy ? take_profit-tp_reference : tp_reference-take_profit);
   const bool sl_valid=(is_buy ? stop_loss<sl_reference-minimum : stop_loss>sl_reference+minimum);
   const bool tp_valid=(is_buy ? take_profit>tp_reference+minimum : take_profit<tp_reference-minimum);
   if(has_stop && !sl_valid)
     { failure=StringFormat("stop_loss too close: distance %s, required >= %s (20 ticks margin)",DoubleToString(sl_distance,digits),DoubleToString(minimum,digits)); return false; }
   if(has_take && !tp_valid)
     { failure=StringFormat("take_profit too close: distance %s, required >= %s (20 ticks margin)",DoubleToString(tp_distance,digits),DoubleToString(minimum,digits)); return false; }
   return true;
  }

void SendRiskQuoteError(const string draft_id,const string code,const string message)
  {
   g_message_id++;
   const string error=StringFormat("{\"v\":1,\"type\":\"risk_quote_error\",\"id\":\"ea-risk-error-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"draft_id\":\"%s\",\"code\":\"%s\",\"message\":\"%s\"}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(draft_id),JsonEscape(code),JsonEscape(message));
   SendFrame(error);
  }

bool SendRiskQuote(const string draft_id,const string symbol,const string side,const string entry_text,const string stop_text,const string take_text)
  {
   if(g_state!=BRIDGE_READY || !EnsureSymbol(symbol) || (side!="buy" && side!="sell"))
     { SendRiskQuoteError(draft_id,"INVALID_MESSAGE","invalid risk quote request"); return false; }
   double entry,stop_loss,take_profit=0.0;
   const bool has_take_profit=(take_text!="");
   if(!ParsePositiveDecimal(entry_text,entry) || !ParsePositiveDecimal(stop_text,stop_loss) || (has_take_profit && !ParsePositiveDecimal(take_text,take_profit)))
     { SendRiskQuoteError(draft_id,"INVALID_MESSAGE","risk quote prices must be positive decimals"); return false; }
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const int tick_digits=(digits>0 ? digits : 8);
   const double tick_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   const double volume_min=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   const double volume_max=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   const double volume_step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   if(tick_size<=0.0 || volume_min<=0.0 || volume_max<volume_min || volume_step<=0.0)
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","invalid symbol trading metadata"); return false; }
   if(side=="buy")
     { entry=TickFloor(entry,tick_size,digits); stop_loss=TickFloor(stop_loss,tick_size,digits); if(has_take_profit) take_profit=TickCeil(take_profit,tick_size,digits); }
   else
     { entry=TickCeil(entry,tick_size,digits); stop_loss=TickCeil(stop_loss,tick_size,digits); if(has_take_profit) take_profit=TickFloor(take_profit,tick_size,digits); }
   if(!ValidRiskGeometry(side,entry,true,stop_loss,has_take_profit,take_profit))
     { SendRiskQuoteError(draft_id,"INVALID_MESSAGE","prices have invalid side geometry after tick normalization"); return false; }
   const double cap=MathMin(1.0,volume_max);
   if(cap<volume_min)
     { SendRiskQuoteError(draft_id,"INVALID_MESSAGE","no reference volume is available"); return false; }
   const long steps=(long)MathFloor((cap-volume_min)/volume_step+1e-9);
   const double reference_volume=NormalizeDouble(volume_min+(double)steps*volume_step,8);
   if(reference_volume<volume_min || reference_volume>volume_max)
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","reference volume normalization failed"); return false; }
   const ENUM_ORDER_TYPE order_type=(side=="buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double margin_at_reference=0.0;
   if(!OrderCalcMargin(order_type,symbol,reference_volume,entry,margin_at_reference) || !MathIsValidNumber(margin_at_reference) || margin_at_reference<0.0)
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","OrderCalcMargin failed for entry"); return false; }
   double stop_profit=0.0;
   if(!OrderCalcProfit(order_type,symbol,reference_volume,entry,stop_loss,stop_profit))
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","OrderCalcProfit failed for stop loss"); return false; }
   if(stop_profit>=0.0)
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","stop loss did not produce a loss"); return false; }
   const double loss_at_reference=(stop_profit<0.0 ? MathAbs(stop_profit) : 0.0);
   double reward_at_reference=0.0;
   if(has_take_profit && !OrderCalcProfit(order_type,symbol,reference_volume,entry,take_profit,reward_at_reference))
     { SendRiskQuoteError(draft_id,"INTERNAL_ERROR","OrderCalcProfit failed for take profit"); return false; }
   if(reward_at_reference<0.0) reward_at_reference=0.0;
   const string reward_json=(has_take_profit ? "\""+DoubleToString(reward_at_reference,8)+"\"" : "null");
   g_message_id++;
   const string response=StringFormat("{\"v\":1,\"type\":\"risk_quote_result\",\"id\":\"ea-risk-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"draft_id\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"entry\":\"%s\",\"stop_loss\":\"%s\",\"take_profit\":%s,\"reference_volume\":\"%s\",\"loss_at_reference\":\"%s\",\"reward_at_reference\":%s,\"margin_at_reference\":\"%s\",\"currency\":\"%s\",\"tick_size\":\"%s\",\"volume_min\":\"%s\",\"volume_max\":\"%s\",\"volume_step\":\"%s\",\"quoted_at_ms\":%I64u}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(draft_id),JsonEscape(symbol),side,DoubleToString(entry,digits),DoubleToString(stop_loss,digits),(has_take_profit?"\""+DoubleToString(take_profit,digits)+"\"":"null"),DoubleToString(reference_volume,8),DoubleToString(loss_at_reference,8),reward_json,DoubleToString(margin_at_reference,8),JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),DoubleToString(tick_size,tick_digits),DoubleToString(volume_min,8),DoubleToString(volume_max,8),DoubleToString(volume_step,8),(ulong)TimeGMT()*1000);
   if(!SendFrame(response)) { SendRiskQuoteError(draft_id,"FRAME_TOO_LARGE","risk quote exceeds frame limit"); return false; }
   return true;
  }

void SendOrderCheckError(const string draft_id,const string code,const string message)
  {
   g_message_id++;
   const string response=StringFormat("{\"v\":1,\"type\":\"order_check_error\",\"id\":\"ea-order-check-error-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"draft_id\":\"%s\",\"code\":\"%s\",\"message\":\"%s\"}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(draft_id),JsonEscape(code),JsonEscape(message));
   SendFrame(response);
  }

bool IsGridValue(const double value,const double minimum,const double maximum,const double step)
  {
   if(value<minimum-1e-9 || value>maximum+1e-9 || step<=0.0) return false;
   const double steps=(value-minimum)/step;
   return MathAbs(steps-MathRound(steps))<=1e-7;
  }

bool IsTickPrice(const double value,const double tick_size)
  {
   if(value<=0.0 || tick_size<=0.0) return false;
   const double ticks=value/tick_size;
   return MathAbs(ticks-MathRound(ticks))<=1e-7;
  }

//--- time-in-force / stop-limit helpers (bridge-v1 additive extension) -------

bool IsValidTimeInForce(const string tif)
  {
   return(tif=="" || tif=="gtc" || tif=="day" || tif=="ioc" || tif=="fok");
  }

// Pending orders: `day` maps to ORDER_TIME_DAY; gtc/ioc/fok and an absent
// field map to ORDER_TIME_GTC (protocol TIF mapping table).
ENUM_ORDER_TYPE_TIME PendingExpiration(const string tif)
  {
   if(tif=="day") return(ORDER_TIME_DAY);
   return(ORDER_TIME_GTC);
  }

// JSON encoding for optional echo fields: "" -> null, else the raw string.
string NullableJsonString(const string value)
  {
   return(value=="" ? "null" : "\""+JsonEscape(value)+"\"");
  }

// Market filling resolution with the documented fallback chains (bridge-v1).
// Absent/gtc/day keep today's FOK -> IOC -> RETURN chain unchanged; requested
// ioc: IOC -> RETURN -> FOK; requested fok: FOK -> IOC -> RETURN. RETURN is
// only admissible outside SYMBOL_TRADE_EXECUTION_MARKET. Returns false when
// the symbol exposes no admissible mode; `note` describes a fallback.
bool ResolveMarketFilling(const string symbol,const string tif,const long execution,ENUM_ORDER_TYPE_FILLING &filling,string &note)
  {
   const long mask=(long)SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE);
   const bool allow_fok=((mask&SYMBOL_FILLING_FOK)!=0);
   const bool allow_ioc=((mask&SYMBOL_FILLING_IOC)!=0);
   const bool allow_return=(execution!=SYMBOL_TRADE_EXECUTION_MARKET);
   note="";
   if(tif=="ioc")
     {
      if(allow_ioc) { filling=ORDER_FILLING_IOC; return(true); }
      if(allow_return) { filling=ORDER_FILLING_RETURN; note="IOC unavailable; using RETURN"; return(true); }
      if(allow_fok) { filling=ORDER_FILLING_FOK; note="IOC unavailable; using FOK"; return(true); }
      return(false);
     }
   if(tif=="fok")
     {
      if(allow_fok) { filling=ORDER_FILLING_FOK; return(true); }
      if(allow_ioc) { filling=ORDER_FILLING_IOC; note="FOK unavailable; using IOC"; return(true); }
      if(allow_return) { filling=ORDER_FILLING_RETURN; note="FOK unavailable; using RETURN"; return(true); }
      return(false);
     }
   if(allow_fok) { filling=ORDER_FILLING_FOK; return(true); }
   if(allow_ioc) { filling=ORDER_FILLING_IOC; return(true); }
   if(allow_return) { filling=ORDER_FILLING_RETURN; return(true); }
   return(false);
  }

// Pending filling resolution (limit/stop/stop_limit): absent/gtc/day keep
// today's ORDER_FILLING_RETURN; a requested IOC/FOK is honored when
// SYMBOL_FILLING_MODE allows it, else falls back IOC -> RETURN and
// FOK -> IOC -> RETURN. RETURN is today's unconditional pending mode, so it
// always resolves for pending orders.
bool ResolvePendingFilling(const string symbol,const string tif,ENUM_ORDER_TYPE_FILLING &filling,string &note)
  {
   const long mask=(long)SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE);
   note="";
   if(tif=="ioc")
     {
      if((mask&SYMBOL_FILLING_IOC)!=0) { filling=ORDER_FILLING_IOC; return(true); }
      filling=ORDER_FILLING_RETURN; note="IOC unavailable; using RETURN"; return(true);
     }
   if(tif=="fok")
     {
      if((mask&SYMBOL_FILLING_FOK)!=0) { filling=ORDER_FILLING_FOK; return(true); }
      if((mask&SYMBOL_FILLING_IOC)!=0) { filling=ORDER_FILLING_IOC; note="FOK unavailable; using IOC"; return(true); }
      filling=ORDER_FILLING_RETURN; note="FOK unavailable; using RETURN"; return(true);
     }
   filling=ORDER_FILLING_RETURN;
   return(true);
  }

bool SendOrderCheck(const string draft_id,const string account_login,const string broker_server,const string symbol,const string side,const string order_kind,const string volume_text,const string entry_text,const string stop_text,const string take_text,const string time_in_force,const string limit_price_text)
  {
   // Bound untrusted strings before using them in symbol lookup or a response.
   if(StringLen(draft_id)>128 || StringLen(account_login)>32 || StringLen(broker_server)>128 || StringLen(symbol)>64 || StringLen(volume_text)>32 || StringLen(entry_text)>32 || StringLen(stop_text)>32 || StringLen(take_text)>32 || StringLen(side)>8 || StringLen(order_kind)>16 || StringLen(time_in_force)>8 || StringLen(limit_price_text)>32)
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","order check request contains an oversized field"); return false; }
   if(g_state!=BRIDGE_READY || account_login!=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) || broker_server!=AccountInfoString(ACCOUNT_SERVER))
     { SendOrderCheckError(draft_id,"ACCOUNT_MISMATCH","request account does not match the connected MT5 account"); return false; }
   if(!EnsureSymbol(symbol) || (side!="buy" && side!="sell") || (order_kind!="market" && order_kind!="limit" && order_kind!="stop" && order_kind!="stop_limit"))
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","invalid symbol, side, or order kind"); return false; }
   if(!IsValidTimeInForce(time_in_force))
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","time_in_force must be gtc, day, ioc, or fok"); return false; }

   double volume=0.0,entry=0.0,stop_loss=0.0,take_profit=0.0;
   const bool has_stop=(stop_text!="");
   const bool has_take=(take_text!="");
   double limit_price=0.0;
   const bool has_limit_price=(limit_price_text!="");
   if(!ParsePositiveDecimal(volume_text,volume) || !ParsePositiveDecimal(entry_text,entry) || (has_stop && !ParsePositiveDecimal(stop_text,stop_loss)) || (has_take && !ParsePositiveDecimal(take_text,take_profit)))
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","volume and supplied prices must be positive decimal values"); return false; }
   if(order_kind=="stop_limit" && !has_limit_price)
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","stop_limit requires limit_price (resting limit price)"); return false; }
   if(has_limit_price && !ParsePositiveDecimal(limit_price_text,limit_price))
     { SendOrderCheckError(draft_id,"INVALID_MESSAGE","limit_price must be a positive decimal value"); return false; }

   const double volume_min=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   const double volume_max=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   const double volume_step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   const double tick_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   if(!IsGridValue(volume,volume_min,volume_max,volume_step))
     { SendOrderCheckError(draft_id,"INVALID_VOLUME","volume must be on the symbol min/max/step grid"); return false; }
   // Tick-alignment of limit_price applies to stop_limit only (ignored for
   // the other kinds, matching Rust); the positive-decimal check above stays.
   if(!IsTickPrice(entry,tick_size) || (has_stop && !IsTickPrice(stop_loss,tick_size)) || (has_take && !IsTickPrice(take_profit,tick_size)) || (order_kind=="stop_limit" && !IsTickPrice(limit_price,tick_size)))
     { SendOrderCheckError(draft_id,"INVALID_PRICE","prices must align with the symbol tick size"); return false; }

   MqlTick tick;
   if(!SymbolInfoTick(symbol,tick) || tick.bid<=0.0 || tick.ask<=0.0)
     { SendOrderCheckError(draft_id,"QUOTE_UNAVAILABLE","live bid/ask quote is unavailable"); return false; }
   const bool is_buy=(side=="buy");
   double check_price=entry;
   if(order_kind=="market") check_price=(is_buy ? tick.ask : tick.bid);
   if(order_kind=="limit" && (is_buy ? entry>=tick.ask : entry<=tick.bid))
     { SendOrderCheckError(draft_id,"INVALID_PRICE","limit entry must be below ask for buy or above bid for sell"); return false; }
   if(order_kind=="stop" && (is_buy ? entry<=tick.ask : entry>=tick.bid))
     { SendOrderCheckError(draft_id,"INVALID_PRICE","stop entry must be above ask for buy or below bid for sell"); return false; }
   if(order_kind=="stop_limit" && (is_buy ? entry<=tick.ask : entry>=tick.bid))
     { SendOrderCheckError(draft_id,"INVALID_PRICE","stop_limit trigger must be above ask for buy or below bid for sell"); return false; }
   const double geometry_entry=(order_kind=="stop_limit" ? limit_price : check_price);
   if((has_stop || has_take) && ((is_buy && ((has_stop && stop_loss>=geometry_entry) || (has_take && take_profit<=geometry_entry))) || (!is_buy && ((has_stop && stop_loss<=geometry_entry) || (has_take && take_profit>=geometry_entry)))))
     { SendOrderCheckError(draft_id,"INVALID_PRICE","stop loss or take profit has invalid side geometry"); return false; }
   string stop_failure="";
   if(!ValidOrderStopDistances(symbol,side,order_kind,geometry_entry,has_stop,stop_loss,has_take,take_profit,tick,stop_failure))
     { SendOrderCheckError(draft_id,"INVALID_PRICE",stop_failure); return false; }

   MqlTradeRequest request={};
   MqlTradeCheckResult checked={};
   string filling_note="";
   request.symbol=symbol;
   request.volume=volume;
   request.price=check_price;
   request.sl=(has_stop ? stop_loss : 0.0);
   request.tp=(has_take ? take_profit : 0.0);
   request.type_time=ORDER_TIME_GTC;
   if(order_kind=="market")
     {
      request.action=TRADE_ACTION_DEAL;
      request.type=(is_buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
      const long execution=(long)SymbolInfoInteger(symbol,SYMBOL_TRADE_EXEMODE);
      // Market execution fills at market: send price 0.0 so no stale fixed price
      // reaches the server — a fixed price on TRADE_ACTION_DEAL can make some
      // servers reject the attached stops (TRADE_RETCODE_INVALID_STOPS).
      // Request/execution modes keep the checked market price above.
      if(execution==SYMBOL_TRADE_EXECUTION_MARKET) request.price=0.0;
      if(!ResolveMarketFilling(symbol,time_in_force,execution,request.type_filling,filling_note))
        { SendOrderCheckError(draft_id,"UNSUPPORTED_FILLING","symbol has no allowed market filling mode"); return false; }
     }
   else
     {
      request.action=TRADE_ACTION_PENDING;
      if(order_kind=="limit") request.type=(is_buy ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT);
      else if(order_kind=="stop") request.type=(is_buy ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP);
      else
        {
         request.type=(is_buy ? ORDER_TYPE_BUY_STOP_LIMIT : ORDER_TYPE_SELL_STOP_LIMIT);
         // MQL5 mapping (verified against CTrade::OrderOpen in this install's
         // standard library: its `limit_price` argument lands in
         // m_request.stoplimit): request.price carries the STOP trigger,
         // request.stoplimit the resting LIMIT price. Resting orders split
         // ORDER_PRICE_OPEN (trigger) / ORDER_PRICE_STOPLIMIT (limit) the
         // same way.
         request.price=NormalizeDouble(entry,digits);
         request.stoplimit=NormalizeDouble(limit_price,digits);
        }
      request.type_time=PendingExpiration(time_in_force);
      if(!ResolvePendingFilling(symbol,time_in_force,request.type_filling,filling_note))
        { SendOrderCheckError(draft_id,"UNSUPPORTED_FILLING","symbol has no allowed pending filling mode"); return false; }
     }
   ResetLastError();
   const bool check_passed=OrderCheck(request,checked);
   const int last_error=GetLastError();
   string comment_text=checked.comment;
   if(filling_note!="") comment_text=comment_text+" | "+filling_note;
   if(StringLen(comment_text)>256) comment_text=StringSubstr(comment_text,0,256);
   const int currency_digits=(int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   const int amount_digits=(currency_digits>=0 && currency_digits<=8 ? currency_digits : 2);
   const string result=StringFormat("{\"v\":1,\"type\":\"order_check_result\",\"id\":\"ea-order-check-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"draft_id\":\"%s\",\"account_login\":\"%s\",\"broker_server\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"order_kind\":\"%s\",\"volume\":\"%s\",\"requested_entry\":\"%s\",\"check_price\":\"%s\",\"stop_loss\":%s,\"take_profit\":%s,\"check_passed\":%s,\"retcode\":%u,\"last_error\":%d,\"balance\":\"%s\",\"equity\":\"%s\",\"profit\":\"%s\",\"margin\":\"%s\",\"free_margin\":\"%s\",\"margin_level\":\"%s\",\"comment\":\"%s\",\"checked_at_ms\":%I64u,\"time_in_force\":%s,\"limit_price\":%s}}",g_message_id+1,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(draft_id),JsonEscape(account_login),JsonEscape(broker_server),JsonEscape(symbol),side,order_kind,JsonEscape(volume_text),JsonEscape(entry_text),DoubleToString(check_price,digits),NullableJsonString(stop_text),(has_take?"\""+JsonEscape(take_text)+"\"":"null"),(check_passed?"true":"false"),checked.retcode,last_error,DoubleToString(checked.balance,amount_digits),DoubleToString(checked.equity,amount_digits),DoubleToString(checked.profit,amount_digits),DoubleToString(checked.margin,amount_digits),DoubleToString(checked.margin_free,amount_digits),DoubleToString(checked.margin_level,4),JsonEscape(comment_text),(ulong)TimeGMT()*1000,NullableJsonString(time_in_force),NullableJsonString(limit_price_text));
   g_message_id++;
   if(!SendFrame(result)) { SendOrderCheckError(draft_id,"FRAME_TOO_LARGE","order check result exceeds frame limit"); return false; }
   return true;
  }

bool HasValidSymbolMetadata(const string symbol)
  {
   const double tick_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   const double volume_min=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   const double volume_max=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   const double volume_step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   const double point_size=SymbolInfoDouble(symbol,SYMBOL_POINT);
   const double contract_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_CONTRACT_SIZE);
   return tick_size>0.0 && volume_step>0.0 && volume_min>0.0 && volume_max>=volume_min && point_size>0.0 && contract_size>0.0;
  }

// Read-only per-lot tick estimates; OrderCalcProfit returns deposit currency.
string AccountTickValuesJson(const string symbol,const double tick_size)
  {
   const string currency=JsonEscape(AccountInfoString(ACCOUNT_CURRENCY));
   MqlTick quote;
   const double minimum=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   const double maximum=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   const double step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   const string unavailable=StringFormat("\"tick_value_profit\":null,\"tick_value_loss\":null,\"tick_value_currency\":\"%s\"",currency);
   if(minimum<=0.0 || maximum<minimum || step<=0.0 || tick_size<=0.0 || !SymbolInfoTick(symbol,quote)) return unavailable;
   const double cap=MathMax(minimum,MathMin(1.0,maximum));
   const double volume=minimum+MathFloor((cap-minimum)/step+1e-9)*step;
   const int digits=(int)AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   // A minimum-lot single tick may round to zero in the deposit currency.
   // Probe enough money for useful precision, then scale back to one lot/tick.
   const double threshold=100.0*MathPow(10.0,-(digits>=0 && digits<=8 ? digits : 2));
   double ticks=1.0;
   for(int attempt=0;attempt<6;attempt++,ticks*=10.0)
     {
      const double distance=tick_size*ticks;
      if(quote.ask<=distance) break;
      double profit=0.0,loss=0.0;
      if(!OrderCalcProfit(ORDER_TYPE_BUY,symbol,volume,quote.ask,quote.ask+distance,profit) ||
         !OrderCalcProfit(ORDER_TYPE_BUY,symbol,volume,quote.ask,quote.ask-distance,loss) ||
         !MathIsValidNumber(profit) || !MathIsValidNumber(loss)) return unavailable;
      if(profit<threshold || -loss<threshold) continue;
      return StringFormat("\"tick_value_profit\":\"%s\",\"tick_value_loss\":\"%s\",\"tick_value_currency\":\"%s\"",
                          DoubleToString(profit/(volume*ticks),8),DoubleToString(-loss/(volume*ticks),8),currency);
     }
   return unavailable;
  }

string SymbolMetadataJson(const string symbol)
  {
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   const int tick_digits=(digits>0 ? digits : 8);
   const double tick_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   const double volume_min=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   const double volume_max=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   const double volume_step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   const double point_size=SymbolInfoDouble(symbol,SYMBOL_POINT);
   const double contract_size=SymbolInfoDouble(symbol,SYMBOL_TRADE_CONTRACT_SIZE);
   const string description=JsonEscape(SymbolInfoString(symbol,SYMBOL_DESCRIPTION));
   const string metadata=StringFormat("{\"symbol\":\"%s\",\"description\":\"%s\",\"digits\":%d,\"tick_size\":\"%s\",\"volume_min\":\"%s\",\"volume_max\":\"%s\",\"volume_step\":\"%s\",\"trade_mode\":%I64d,\"point_size\":\"%s\",\"contract_size\":\"%s\",\"stops_level\":%I64d,\"freeze_level\":%I64d,\"filling_mode\":%I64d,\"order_mode\":%I64d,\"expiration_mode\":%I64d,\"trade_execution\":%I64d}",JsonEscape(symbol),description,digits,DoubleToString(tick_size,tick_digits),DoubleToString(volume_min,8),DoubleToString(volume_max,8),DoubleToString(volume_step,8),SymbolInfoInteger(symbol,SYMBOL_TRADE_MODE),DoubleToString(point_size,tick_digits),DoubleToString(contract_size,8),SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL),SymbolInfoInteger(symbol,SYMBOL_TRADE_FREEZE_LEVEL),SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE),SymbolInfoInteger(symbol,SYMBOL_ORDER_MODE),SymbolInfoInteger(symbol,SYMBOL_EXPIRATION_MODE),SymbolInfoInteger(symbol,SYMBOL_TRADE_EXEMODE));
   return StringSubstr(metadata,0,StringLen(metadata)-1)+","+AccountTickValuesJson(symbol,tick_size)+"}";
  }

bool SendSymbolSearchResult(const string request_id,const string query,const long limit)
  {
   if(limit<1 || limit>50)
     {
      SendProtocolError("INVALID_MESSAGE","symbol search limit must be 1..50");
      return false;
     }
   string needle=query;
   StringToLower(needle);
   string result=StringFormat("{\"v\":1,\"type\":\"symbol_search_result\",\"id\":\"ea-symbols-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"query\":\"%s\",\"symbols\":[",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(request_id),JsonEscape(query));
   int found=0;
   const int total=SymbolsTotal(false);
   for(int i=0;i<total && found<(int)limit;i++)
     {
      const string symbol=SymbolName(i,false);
      const string description=SymbolInfoString(symbol,SYMBOL_DESCRIPTION);
      string symbol_lower=symbol;
      string description_lower=description;
      StringToLower(symbol_lower);
      StringToLower(description_lower);
      if(needle!="" && StringFind(symbol_lower,needle)<0 && StringFind(description_lower,needle)<0) continue;
      if(!HasValidSymbolMetadata(symbol)) continue;
      if(found>0) result+=",";
      result+=SymbolMetadataJson(symbol);
      found++;
     }
   result+="]}}";
   if(!SendFrame(result))
     {
      SendProtocolError("FRAME_TOO_LARGE","symbol search result exceeds frame limit");
      return false;
     }
   return true;
  }

bool SendSymbolInfoResult(const string request_id,const string symbol)
  {
   if(!EnsureSymbol(symbol) || !HasValidSymbolMetadata(symbol))
     {
      SendProtocolError("INVALID_MESSAGE","unsupported symbol info request");
      return false;
     }
   g_message_id++;
   const string response=StringFormat("{\"v\":1,\"type\":\"symbol_info_result\",\"id\":\"ea-symbol-info-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"symbol_info\":%s}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(request_id),SymbolMetadataJson(symbol));
   if(!SendFrame(response))
     {
      SendProtocolError("FRAME_TOO_LARGE","symbol info result exceeds frame limit");
      return false;
     }
   return true;
  }

string CandleJson(const MqlRates &bar,const int digits)
  {
   return StringFormat("{\"time_ms\":%I64d,\"open\":\"%s\",\"high\":\"%s\",\"low\":\"%s\",\"close\":\"%s\",\"tick_volume\":%I64u,\"spread\":%d,\"real_volume\":%I64u}",
                       (long)bar.time*1000,DoubleToString(bar.open,digits),DoubleToString(bar.high,digits),DoubleToString(bar.low,digits),DoubleToString(bar.close,digits),bar.tick_volume,bar.spread,bar.real_volume);
  }

void SendProtocolError(const string code,const string message)
  {
   g_message_id++;
   const string error=StringFormat("{\"v\":1,\"type\":\"error\",\"id\":\"ea-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"code\":\"%s\",\"message\":\"%s\",\"retryable\":false}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(code),JsonEscape(message));
   SendFrame(error);
  }

bool SendHistorySnapshot(const string request_id,const string symbol,const string timeframe_name,const ENUM_TIMEFRAMES timeframe,const long bars)
  {
   if(!EnsureSymbol(symbol) || bars<1 || bars>1000)
     {
      SendProtocolError("INVALID_MESSAGE","unsupported history request");
      return false;
     }
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   const int copied=CopyRates(symbol,timeframe,0,(int)bars,rates);
   if(copied<=0)
     {
      SendProtocolError("INTERNAL_ERROR","CopyRates failed");
      return false;
     }
   ArraySetAsSeries(rates,false);
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   string snapshot=StringFormat("{\"v\":1,\"type\":\"history_snapshot\",\"id\":\"ea-history-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"complete\":%s,\"candles\":[",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(request_id),JsonEscape(symbol),timeframe_name,(copied==(int)bars?"true":"false"));
   for(int i=0;i<copied;i++)
     {
      if(i>0) snapshot+=",";
      snapshot+=CandleJson(rates[i],digits);
     }
   snapshot+="]}}";
   if(!SendFrame(snapshot))
     {
      SendProtocolError("FRAME_TOO_LARGE","history snapshot exceeds frame limit");
      return false;
     }
   g_last_bar=rates[copied-1];
   g_have_last_bar=true;
   g_history_ready=true;
   g_active_symbol=symbol;
   g_active_timeframe_name=timeframe_name;
   g_active_timeframe=timeframe;
   return true;
  }

/**
 * One page of candles strictly older than `before_ms`, for lazy loading.
 *
 * This deliberately never writes the live-feed state SendHistorySnapshot
 * establishes (`g_last_bar`, `g_have_last_bar`, `g_history_ready`,
 * `g_active_symbol`/`g_active_timeframe*`) and never cancels the tick reader: a
 * page reads the past, and moving those anchors would re-point the bar
 * countdown, the quote feed and the bar_update staleness check at an old
 * candle.
 *
 * Every failure answers an empty, incomplete page rather than a protocol error.
 * A peer error frame must not appear here: the bridge recognizes tick-page error
 * ids only, so anything else tears the session down, while an empty page is
 * already the "no older candles" answer the client acts on.
 */
bool SendHistoryPage(const string request_id,const string symbol,const string timeframe_name,const ENUM_TIMEFRAMES timeframe,const long bars,const long before_ms)
  {
   MqlRates rates[];
   int copied=0;
   if(EnsureSymbol(symbol) && timeframe!=PERIOD_CURRENT && bars>=1 && bars<=1000 && before_ms>0 &&
      g_history_ready && symbol==g_active_symbol && timeframe_name==g_active_timeframe_name)
     {
      // The anchor is the open time of the oldest candle the client holds, so
      // the page starts at the bar immediately older than it.
      const int shift=iBarShift(symbol,timeframe,(datetime)(before_ms/1000),false);
      if(shift>=0)
        {
         ArraySetAsSeries(rates,false);
         copied=CopyRates(symbol,timeframe,shift+1,(int)bars,rates);
         ArraySetAsSeries(rates,false);
         if(copied<0) copied=0;
        }
     }
   const int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   string snapshot=StringFormat("{\"v\":1,\"type\":\"history_snapshot\",\"id\":\"ea-history-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"complete\":%s,\"before_ms\":%I64d,\"candles\":[",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(request_id),JsonEscape(symbol),JsonEscape(timeframe_name),(copied==(int)bars?"true":"false"),before_ms);
   for(int i=0;i<copied;i++)
     {
      if(i>0) snapshot+=",";
      snapshot+=CandleJson(rates[i],digits);
     }
   snapshot+="]}}";
   return SendFrame(snapshot);
  }

string TickJson(const MqlTick &tick,const int digits)
  {
   return "{"+TickJsonFields(tick,digits)+"}";
  }

string TickJsonFields(const MqlTick &tick,const int digits)
  {
   return StringFormat("\"time_ms\":%I64d,\"bid\":\"%s\",\"ask\":\"%s\",\"last\":\"%s\",\"volume\":%I64u,\"volume_real\":\"%s\",\"flags\":%u",
                       tick.time_msc,DoubleToString(tick.bid,digits),DoubleToString(tick.ask,digits),DoubleToString(tick.last,digits),tick.volume,DoubleToString(tick.volume_real,8),(uint)tick.flags);
  }

void ReleaseTickReader()
  {
   if(g_tick_reader!=INVALID_HANDLE) IndicatorRelease(g_tick_reader);
   g_tick_reader=INVALID_HANDLE;
   if(g_tick_file!="")
     {
      FileDelete(g_tick_file);
      FileDelete(g_tick_file+".tmp");
     }
   g_tick_file="";
  }

void CancelTickHistory()
  {
   ReleaseTickReader();
   g_tick_request="";
   g_tick_header="";
   g_price_index.Clear();
   ArrayResize(g_prices,0);
   g_price_count=0;
   g_price_cursor=0;
   g_tick_aggregate=false;
   ArrayResize(g_tick_payload,0);
   g_tick_payload_size=0;
   ArrayResize(g_tick_page,0);
  }

void FailTickHistory(const string reason)
  {
   const string request_id=g_tick_request;
   PrintFormat("BetterChartsBridge tick history failed: %s",reason);
   CancelTickHistory();
   // A correlated market-data failure ends this profile, not the session.
   const string error=StringFormat("{\"v\":1,\"type\":\"error\",\"id\":\"%s\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"%s\",\"retryable\":false}}",JsonEscape(request_id),JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(reason));
   if(!SendFrame(error)) DisconnectAndRetry("tick history error send failed");
  }

bool StartTickReaderAttempt()
  {
   g_tick_attempt_ms=GetTickCount64();
   g_tick_file=StringFormat("TradeCanvasTicks\\%I64d-%I64u-%I64u.bin",ChartID(),g_tick_attempt_ms,++g_tick_job_sequence);
   g_tick_reader=iCustom(g_tick_symbol,PERIOD_M1,"BetterChartsTickHistoryReader",g_tick_from,(uint)g_tick_max+1,g_tick_file);
   if(g_tick_reader==INVALID_HANDLE) { FailTickHistory("tick history reader unavailable"); return false; }
   return true;
  }

void ReleaseReaderProbe()
  {
   if(g_probe_reader!=INVALID_HANDLE) IndicatorRelease(g_probe_reader);
   g_probe_reader=INVALID_HANDLE;
   if(g_probe_file!="")
     {
      FileDelete(g_probe_file);
      FileDelete(g_probe_file+".tmp");
     }
   g_probe_file="";
   g_probe_active=false;
  }

// Accepts only "<digits>.<digits>" (the MT5 #property version format).
bool ValidReaderVersion(const string version)
  {
   const int length=StringLen(version);
   if(length<3 || length>=BRIDGE_READER_VERSION_BYTES) return false;
   int dot=-1;
   for(int i=0;i<length;i++)
     {
      const ushort ch=StringGetCharacter(version,i);
      if(ch=='.')
        {
         if(dot>=0 || i==0 || i==length-1) return false;
         dot=i;
        }
      else if(ch<'0' || ch>'9') return false;
     }
   return dot>0;
  }

// Parses the probe page header. Returns false for anything but a current
// versioned page, so an unversioned or malformed reader reports a null version.
bool ParseReaderVersion(const int file,string &version)
  {
   version="";
   if(FileSize(file)<BRIDGE_READER_HEADER_BYTES) return false;
   if(FileReadInteger(file,INT_VALUE)!=BRIDGE_READER_MAGIC) return false;
   uchar raw[BRIDGE_READER_VERSION_BYTES];
   if(FileReadArray(file,raw,0,BRIDGE_READER_VERSION_BYTES)!=(uint)BRIDGE_READER_VERSION_BYTES) return false;
   string parsed="";
   int end=0;
   while(end<BRIDGE_READER_VERSION_BYTES && raw[end]!=0)
     {
      parsed+=CharToString(raw[end]);
      end++;
     }
   for(int i=end;i<BRIDGE_READER_VERSION_BYTES;i++)
      if(raw[i]!=0) return false;
   if(!ValidReaderVersion(parsed)) return false;
   version=parsed;
   return true;
  }

void FinishReaderProbe(const string version)
  {
   g_reader_version=version;
   ReleaseReaderProbe();
   g_probe_done=true;
   PrintFormat("BetterChartsBridge tick reader version: %s",(version=="" ? "unavailable" : version));
  }

// Nonblocking: each call does a bounded amount of work and returns false while
// the probe is pending, so the timer keeps running. Returns true when settled.
bool RunReaderProbe()
  {
   if(g_probe_done) return true;
   const ulong now=GetTickCount64();
   if(!g_probe_active)
     {
      g_probe_file=StringFormat("TradeCanvasTicks\\probe-%I64d-%I64u.bin",ChartID(),now);
      FileDelete(g_probe_file);
      FileDelete(g_probe_file+".tmp");
      g_probe_started_ms=now;
      g_probe_active=true;
      g_probe_reader=iCustom(_Symbol,PERIOD_M1,"BetterChartsTickHistoryReader",(long)TimeCurrent()*1000,(uint)2,g_probe_file);
      if(g_probe_reader==INVALID_HANDLE) { FinishReaderProbe(""); return true; }
      return false;
     }
   if(now-g_probe_started_ms>=BRIDGE_READER_PROBE_TIMEOUT_MS) { FinishReaderProbe(""); return true; }
   if(!FileIsExist(g_probe_file)) return false;
   const int file=FileOpen(g_probe_file,FILE_READ|FILE_BIN);
   if(file==INVALID_HANDLE) return false;
   string version;
   const bool ok=ParseReaderVersion(file,version);
   FileClose(file);
   FinishReaderProbe(ok ? version : "");
   return true;
  }

bool QueueTickHistory(const string request_id,const string symbol,const long from_ms,const long to_ms,const long max_ticks,const bool price_counts=false)
  {
   if((price_counts && !g_price_counts_enabled) || !EnsureSymbol(symbol) || from_ms<0 || to_ms<=from_ms || max_ticks<1 || max_ticks>(long)g_max_ticks_per_page)
     {
      SendProtocolError("INVALID_MESSAGE","unsupported tick history request");
      return false;
     }
   CancelTickHistory();
   g_tick_request=request_id;
   g_tick_aggregate=price_counts;
   g_tick_symbol=symbol;
   g_tick_from=from_ms;
   g_tick_to=to_ms;
   g_tick_max=max_ticks;
   g_tick_started_ms=GetTickCount64();
   // CopyTicks is nonblocking in the indicator. Recreate a fresh one-shot
   // instance for each synchronization attempt; it has no dependent timer.
   Print("BetterChartsBridge tick history queued");
   return StartTickReaderAttempt();
  }

bool PriceCountsRequested(const string json,const string name)
  {
   const string marker="\""+name+"\"";
   int index=StringFind(json,marker);
   if(index<0) return false;
   index+=StringLen(marker);
   while(index<StringLen(json) && StringGetCharacter(json,index)<=32) index++;
   if(index>=StringLen(json) || StringGetCharacter(json,index)!=':') return false;
   index++;
   while(index<StringLen(json) && StringGetCharacter(json,index)<=32) index++;
   return StringSubstr(json,index,4)=="true";
  }

bool PreparePriceTickPayload()
  {
   const int copied=ArraySize(g_tick_page);
   g_tick_accepted=(int)MathMin(copied,g_tick_max);
   while(g_tick_accepted>0 && g_tick_page[g_tick_accepted-1].time_msc>=g_tick_to) g_tick_accepted--;
   g_tick_through=g_tick_to;
   if(!g_tick_complete)
     {
      g_tick_through=(g_tick_accepted>0 ? g_tick_page[g_tick_accepted-1].time_msc : g_tick_from);
      while(g_tick_accepted>0 && g_tick_page[g_tick_accepted-1].time_msc>=g_tick_through) g_tick_accepted--;
      if(g_tick_accepted==0) g_tick_through=g_tick_from;
     }
   g_tick_cursor=0;
   g_tick_rejected=0;
   g_price_cursor=0;
   g_price_count=0;
   if(ArrayResize(g_prices,g_tick_accepted*2)!=g_tick_accepted*2)
     { FailTickHistory("price counter allocation failed"); return false; }
   g_tick_header="price-counts";
   return true;
  }

bool AddPriceCount(const double value,const int digits,const uint total,const uint bid,const uint ask,const bool bid_seen)
  {
   const string price=DoubleToString(value,digits);
   int index=0;
   if(!g_price_index.TryGetValue(price,index))
     {
      index=g_price_count;
      if(index>=ArraySize(g_prices) || !g_price_index.Add(price,index)) return false;
      g_prices[index].price=price;
      g_prices[index].total=0;
      g_prices[index].bid=0;
      g_prices[index].ask=0;
      g_prices[index].bid_seen=false;
      g_price_count++;
     }
   g_prices[index].total+=total;
   g_prices[index].bid+=bid;
   g_prices[index].ask+=ask;
   g_prices[index].bid_seen=(g_prices[index].bid_seen || bid_seen);
   return true;
  }

bool GrowTickPayload(const int required)
  {
   if(required<0 || required>(int)g_max_frame_bytes) return false;
   const int current=ArraySize(g_tick_payload);
   if(required<=current) return true;
   // Geometric growth bounds total copied bytes, including high-cardinality
   // summaries. Fixed-size growth repeatedly copies an ever larger prefix.
   const long target=MathMax((long)required,MathMax((long)65536,(long)current*2));
   const int capacity=(int)MathMin((long)g_max_frame_bytes,target);
   return ArrayResize(g_tick_payload,capacity)==capacity;
  }

bool AppendPricePayload(const string entry)
  {
   uchar bytes[];
   if(!Utf8Bytes(entry,bytes)) return false;
   const int size=ArraySize(bytes);
   if(size>(int)g_max_frame_bytes-g_tick_payload_size) return false;
   if(!GrowTickPayload(g_tick_payload_size+size)) return false;
   ArrayCopy(g_tick_payload,bytes,g_tick_payload_size,0,size);
   g_tick_payload_size+=size;
   return true;
  }

void PollPriceTickPayload()
  {
   const int digits=(int)SymbolInfoInteger(g_tick_symbol,SYMBOL_DIGITS);
   const ulong started=GetTickCount64();
   while(g_tick_cursor<g_tick_accepted)
     {
      const int index=g_tick_cursor++;
      const double bid=g_tick_page[index].bid,ask=g_tick_page[index].ask;
      const double low=MathMin(bid,ask),high=MathMax(bid,ask);
      if(index==0) { g_tick_min_quote=low; g_tick_max_quote=high; }
      else { g_tick_min_quote=MathMin(g_tick_min_quote,low); g_tick_max_quote=MathMax(g_tick_max_quote,high); }
      const bool valid=(bid>0 && ask>0);
      const bool bid_changed=((g_tick_page[index].flags&TICK_FLAG_BID)!=0);
      const bool ask_changed=((g_tick_page[index].flags&TICK_FLAG_ASK)!=0);
      if(!valid) g_tick_rejected++;
      if(!AddPriceCount(bid,digits,(valid && (bid_changed || ask_changed) ? 1 : 0),(valid && bid_changed ? 1 : 0),0,true) ||
         (valid && ask_changed && !AddPriceCount(ask,digits,0,0,1,false)))
        { FailTickHistory("price counter allocation failed"); return; }
      if(GetTickCount64()-started>=5) return;
     }
   if(g_tick_payload_size==0)
     {
      const string tick_size=DoubleToString(SymbolInfoDouble(g_tick_symbol,SYMBOL_TRADE_TICK_SIZE),digits);
      const string header=StringFormat("{\"v\":1,\"type\":\"tick_price_history_snapshot\",\"id\":\"ea-ticks-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"symbol\":\"%s\",\"from_ms\":%I64d,\"to_ms\":%I64d,\"tick_size\":\"%s\",\"prices\":[",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(g_tick_request),JsonEscape(g_tick_symbol),g_tick_from,g_tick_to,tick_size);
      if(!AppendPricePayload(header)) { FailTickHistory("price envelope exceeds frame limit"); return; }
     }
   while(g_price_cursor<g_price_count)
     {
      const int index=g_price_cursor++;
      const string entry=StringFormat("%s{\"price\":\"%s\",\"total\":%u,\"bid\":%u,\"ask\":%u,\"bid_seen\":%s}",(index>0 ? "," : ""),g_prices[index].price,g_prices[index].total,g_prices[index].bid,g_prices[index].ask,(g_prices[index].bid_seen ? "true" : "false"));
      // An unusually broad price set can exceed the frame budget. Reuse the
      // already-read page through the raw path without sampling or another read.
      if(StringLen(entry)+512>(int)g_max_frame_bytes-g_tick_payload_size || !AppendPricePayload(entry))
        {
         g_tick_aggregate=false;
         g_price_index.Clear();
         ArrayResize(g_prices,0);
         PrepareRawTickPayload();
         return;
        }
      if(GetTickCount64()-started>=5) return;
     }
   const string low=(g_tick_accepted>0 ? "\""+DoubleToString(g_tick_min_quote,digits)+"\"" : "null");
   const string high=(g_tick_accepted>0 ? "\""+DoubleToString(g_tick_max_quote,digits)+"\"" : "null");
   const string suffix=StringFormat("],\"complete\":%s,\"through_ms\":%I64d,\"loaded_ticks\":%d,\"rejected_ticks\":%u,\"min_quote\":%s,\"max_quote\":%s}}",(g_tick_complete ? "true" : "false"),g_tick_through,g_tick_accepted,g_tick_rejected,low,high);
   if(!AppendPricePayload(suffix)) { FailTickHistory("price envelope exceeds frame limit"); return; }
   if(!SendPayloadBytes(g_tick_payload,g_tick_payload_size)) { DisconnectAndRetry("tick price snapshot send failed"); return; }
   PrintFormat("BetterChartsBridge tick page delivered: mode=prices records=%d prices=%d bytes=%d read_ms=%I64u work_ms=%I64u complete=%s",g_tick_accepted,g_price_count,g_tick_payload_size,g_tick_reader_ready_ms-g_tick_started_ms,GetTickCount64()-g_tick_reader_ready_ms,(g_tick_complete ? "yes" : "no"));
   CancelTickHistory();
  }

bool PrepareRawTickPayload()
  {
      const int digits=(int)SymbolInfoInteger(g_tick_symbol,SYMBOL_DIGITS);
      const string tick_size=DoubleToString(SymbolInfoDouble(g_tick_symbol,SYMBOL_TRADE_TICK_SIZE),digits);
      g_tick_header=StringFormat("{\"v\":1,\"type\":\"tick_history_snapshot\",\"id\":\"ea-ticks-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"request_id\":\"%s\",\"symbol\":\"%s\",\"from_ms\":%I64d,\"to_ms\":%I64d,\"tick_size\":\"%s\",\"ticks\":[",++g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(g_tick_request),JsonEscape(g_tick_symbol),g_tick_from,g_tick_to,tick_size);
      uchar header_bytes[];
      if(!Utf8Bytes(g_tick_header,header_bytes)) { FailTickHistory("invalid tick history envelope"); return false; }
      // Reserve the larger false-complete suffix; true is one byte shorter.
      g_tick_budget=(int)g_max_frame_bytes-ArraySize(header_bytes)-21;
      if(g_tick_budget<0) { FailTickHistory("tick history envelope exceeds frame limit"); return false; }
      g_tick_payload_size=ArraySize(header_bytes);
      const int reserve=(int)MathMin((long)g_max_frame_bytes,g_tick_payload_size+g_tick_max*160+21);
      if(ArrayResize(g_tick_payload,reserve)!=reserve) { FailTickHistory("tick buffer allocation failed"); return false; }
      ArrayCopy(g_tick_payload,header_bytes,0,0,g_tick_payload_size);
      g_tick_cursor=0;
      g_tick_emitted=0;
      g_tick_bytes=0;
   return true;
  }

void PollTickHistory()
  {
   if(g_tick_request=="" || g_state!=BRIDGE_READY) return;
   if(g_tick_header=="")
     {
      if(GetTickCount64()-g_tick_started_ms>120000) { FailTickHistory("tick history synchronization timed out"); return; }
      if(g_tick_reader==INVALID_HANDLE)
        {
         if(GetTickCount64()-g_tick_attempt_ms>=250) StartTickReaderAttempt();
         return;
        }
      if(!FileIsExist(g_tick_file)) return;
      const int file=FileOpen(g_tick_file,FILE_READ|FILE_BIN);
      if(file==INVALID_HANDLE) return;
      const int magic=FileReadInteger(file,INT_VALUE);
      uchar reader_version[BRIDGE_READER_VERSION_BYTES];
      // The connect-time probe validated the version; the page parser only
      // skips those bytes and fails closed on any other magic.
      const bool versioned=(magic==BRIDGE_READER_MAGIC &&
                            FileReadArray(file,reader_version,0,BRIDGE_READER_VERSION_BYTES)==(uint)BRIDGE_READER_VERSION_BYTES);
      const int error=(versioned ? FileReadInteger(file,INT_VALUE) : -1);
      const int copied=(versioned ? FileReadInteger(file,INT_VALUE) : -1);
      bool valid=(versioned && error==0 && copied>=0 && copied<=g_tick_max+1 &&
                  FileSize(file)==BRIDGE_READER_HEADER_BYTES+(ulong)copied*sizeof(MqlTick));
      if(valid && copied>0)
        {
         ArrayResize(g_tick_page,copied);
         valid=(FileReadArray(file,g_tick_page,0,copied)==(uint)copied);
        }
      FileClose(file);
      ReleaseTickReader();
      if(magic==BRIDGE_READER_MAGIC_LEGACY) { FailTickHistory("tick history reader is outdated; update BetterChartsTickHistoryReader"); return; }
      if(versioned && copied==0 && (error==4401 || error==4403)) return;
      if(!valid) { FailTickHistory("tick history reader failed"); return; }
      for(int i=0;i<copied;i++)
        {
         if(g_tick_page[i].time_msc<g_tick_from || (i>0 && g_tick_page[i-1].time_msc>g_tick_page[i].time_msc))
           { FailTickHistory("invalid tick history reader page"); return; }
        }
      g_tick_reader_ready_ms=GetTickCount64();
      g_tick_complete=!(copied>(int)g_tick_max && g_tick_page[(int)g_tick_max].time_msc<g_tick_to);
      if(g_tick_aggregate)
        {
         if(!PreparePriceTickPayload()) return;
        }
      else if(!PrepareRawTickPayload()) return;
     }
   if(g_tick_aggregate) { PollPriceTickPayload(); return; }
   const int digits=(int)SymbolInfoInteger(g_tick_symbol,SYMBOL_DIGITS);
   const int copied=ArraySize(g_tick_page);
   const ulong started=GetTickCount64();
   // Bound JSON work per timer turn so heartbeat, quotes and execution keep
   // their normal schedules even when a page contains tens of thousands of ticks.
   while(g_tick_cursor<copied && g_tick_emitted<(int)g_tick_max)
     {
      const int i=g_tick_cursor++;
      if(g_tick_page[i].time_msc>=g_tick_to) { g_tick_cursor=copied; break; }
      const string entry=TickJson(g_tick_page[i],digits);
      const int bytes=StringLen(entry)+(g_tick_emitted>0 ? 1 : 0);
      if(bytes>g_tick_budget-g_tick_bytes)
        {
         if(g_tick_emitted==0) { FailTickHistory("tick record exceeds frame budget"); return; }
         g_tick_complete=false;
         g_tick_cursor=copied;
         break;
        }
      uchar entry_bytes[];
      if(!Utf8Bytes(entry,entry_bytes)) { FailTickHistory("invalid tick record encoding"); return; }
      const int required=g_tick_payload_size+bytes+21;
      if(!GrowTickPayload(required)) { FailTickHistory("tick buffer allocation failed"); return; }
      if(g_tick_emitted>0) g_tick_payload[g_tick_payload_size++]=',';
      ArrayCopy(g_tick_payload,entry_bytes,g_tick_payload_size,0,ArraySize(entry_bytes));
      g_tick_payload_size+=ArraySize(entry_bytes);
      g_tick_bytes+=bytes;
      g_tick_emitted++;
      if(GetTickCount64()-started>=5) return;
     }
   const string suffix=(g_tick_complete ? "],\"complete\":true}}" : "],\"complete\":false}}");
   uchar suffix_bytes[];
   if(!Utf8Bytes(suffix,suffix_bytes)) { FailTickHistory("invalid tick envelope suffix"); return; }
   ArrayCopy(g_tick_payload,suffix_bytes,g_tick_payload_size,0,ArraySize(suffix_bytes));
   g_tick_payload_size+=ArraySize(suffix_bytes);
   if(!SendPayloadBytes(g_tick_payload,g_tick_payload_size)) { DisconnectAndRetry("tick history snapshot send failed"); return; }
   PrintFormat("BetterChartsBridge tick page delivered: mode=raw records=%d bytes=%d read_ms=%I64u work_ms=%I64u complete=%s",g_tick_emitted,g_tick_payload_size,g_tick_reader_ready_ms-g_tick_started_ms,GetTickCount64()-g_tick_reader_ready_ms,(g_tick_complete ? "yes" : "no"));
   CancelTickHistory();
  }

bool SameBar(const MqlRates &a,const MqlRates &b)
  {
   return a.time==b.time && a.open==b.open && a.high==b.high && a.low==b.low && a.close==b.close &&
          a.tick_volume==b.tick_volume && a.spread==b.spread && a.real_volume==b.real_volume;
  }

bool SameTick(const MqlTick &a,const MqlTick &b)
  {
   return a.time==b.time && a.time_msc==b.time_msc && a.bid==b.bid && a.ask==b.ask && a.last==b.last &&
          a.volume==b.volume && a.volume_real==b.volume_real && a.flags==b.flags;
  }

bool PollCurrentQuote()
  {
   if(!g_history_ready || g_state!=BRIDGE_READY || g_active_symbol=="") return false;
   MqlTick current;
   if(!SymbolInfoTick(g_active_symbol,current)) return false;
   if(g_have_last_quote && SameTick(current,g_last_quote)) return false;
   const int digits=(int)SymbolInfoInteger(g_active_symbol,SYMBOL_DIGITS);
   g_message_id++;
   const string quote=StringFormat("{\"v\":1,\"type\":\"quote_update\",\"id\":\"ea-quote-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"symbol\":\"%s\",%s}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(g_active_symbol),TickJsonFields(current,digits));
   if(SendFrame(quote))
     {
      g_last_quote=current;
      g_have_last_quote=true;
      return true;
     }
   return false;
  }

void PollCurrentBar()
  {
   if(!g_history_ready || g_state!=BRIDGE_READY || g_active_symbol=="") return;
   MqlRates current[];
   ArraySetAsSeries(current,false);
   if(CopyRates(g_active_symbol,g_active_timeframe,0,1,current)!=1) return;
   ArraySetAsSeries(current,false);
   if(g_have_last_bar && SameBar(current[0],g_last_bar)) return;
   const int digits=(int)SymbolInfoInteger(g_active_symbol,SYMBOL_DIGITS);
   g_message_id++;
   const string update=StringFormat("{\"v\":1,\"type\":\"bar_update\",\"id\":\"ea-bar-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"candle\":%s}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,JsonEscape(g_active_symbol),g_active_timeframe_name,CandleJson(current[0],digits));
   if(SendFrame(update))
     {
      g_last_bar=current[0];
      g_have_last_bar=true;
     }
  }

void PollMarketData()
  {
   const bool quote_changed=PollCurrentQuote();
   const ulong now=GetTickCount64();
   // A bar can only advance on market data, so CopyRates belongs on the new
   // tick path. The slow fallback still catches late history corrections.
   if(quote_changed || g_last_bar_poll_ms==0 || now-g_last_bar_poll_ms>=BRIDGE_BAR_FALLBACK_MS)
     {
      PollCurrentBar();
      g_last_bar_poll_ms=now;
     }
  }

//--- command registry, durable journal, and order-command frames -------------

string CommandTextJson(const string value)
  { return (value==""?"null":"\""+JsonEscape(value)+"\""); }

string CommandLongJson(const long value)
  { return (value<0?"null":IntegerToString(value)); }

int FindCommand(const string command_id)
  {
   const int total=ArraySize(g_commands);
   for(int i=0;i<total;i++)
     {
      if(g_commands[i].command_id==command_id) return i;
     }
   return -1;
  }

string CommandJournalLine(const BridgeCommandRecord &rec)
  {
   return StringFormat("{\"command_id\":\"%s\",\"payload_hash\":\"%s\",\"at_update\":%I64d,\"status\":\"%s\",\"retcode\":%s,\"last_error\":%s,\"broker_order_id\":%s,\"deal_id\":%s,\"position_id\":%s,\"filled_volume\":%s,\"message\":%s,\"updated_at_ms\":%I64d}",
                       JsonEscape(rec.command_id),JsonEscape(rec.payload_hash),rec.at_update,JsonEscape(rec.status),
                       CommandLongJson(rec.retcode),CommandLongJson(rec.last_error),CommandTextJson(rec.broker_order_id),
                       CommandTextJson(rec.deal_id),CommandTextJson(rec.position_id),CommandTextJson(rec.filled_volume),
                       OptionalTextJson(rec.message),rec.updated_at_ms);
  }

bool JournalAppendLine(const string line)
  {
   const int handle=FileOpen(BRIDGE_COMMAND_JOURNAL,FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE) return false;
   FileSeek(handle,0,SEEK_END);
   const uint written=FileWriteString(handle,line+"\n");
   FileFlush(handle);
   FileClose(handle);
   return written>0;
  }

void RemoveCommandAt(const int index)
  {
   const int total=ArraySize(g_commands);
   if(index<0 || index>=total) return;
   for(int i=index+1;i<total;i++) g_commands[i-1]=g_commands[i];
   ArrayResize(g_commands,total-1);
  }

bool CommandIsActive(const string command_id)
  {
   if(command_id=="") return false;
   if(command_id==g_inflight_id || command_id==g_watch_id) return true;
   for(int i=0;i<g_queue_count;i++)
     {
      if(g_queue[i].command_id==command_id) return true;
     }
   return false;
  }

bool EvictOldestCommand()
  {
   const int total=ArraySize(g_commands);
   for(int i=0;i<total;i++)
     {
      if(CommandIsActive(g_commands[i].command_id)) continue;
      RemoveCommandAt(i);
      return true;
     }
   return false;
  }

bool ApplyCommandEvent(const string command_id,const string payload_hash,const string status,const long at_update,const long retcode,const long last_error,const string broker_order_id,const string deal_id,const string position_id,const string filled_volume,const string message,const long updated_at_ms)
  {
   int idx=FindCommand(command_id);
   if(idx<0)
     {
      if(ArraySize(g_commands)>=BRIDGE_COMMAND_REGISTRY_MAX && !EvictOldestCommand()) return false;
      const int total=ArraySize(g_commands)+1;
      ArrayResize(g_commands,total);
      idx=total-1;
      g_commands[idx].command_id=command_id;
      g_commands[idx].payload_hash="";
      g_commands[idx].status="";
      g_commands[idx].at_update=0;
      g_commands[idx].retcode=-1;
      g_commands[idx].last_error=-1;
      g_commands[idx].broker_order_id="";
      g_commands[idx].deal_id="";
      g_commands[idx].position_id="";
      g_commands[idx].filled_volume="";
      g_commands[idx].message="";
      g_commands[idx].updated_at_ms=0;
     }
   if(at_update<g_commands[idx].at_update) return false;
   if(payload_hash!="") g_commands[idx].payload_hash=payload_hash;
   g_commands[idx].status=status;
   g_commands[idx].at_update=at_update;
   g_commands[idx].retcode=retcode;
   g_commands[idx].last_error=last_error;
   if(broker_order_id!="") g_commands[idx].broker_order_id=broker_order_id;
   if(deal_id!="") g_commands[idx].deal_id=deal_id;
   if(position_id!="") g_commands[idx].position_id=position_id;
   if(filled_volume!="") g_commands[idx].filled_volume=filled_volume;
   if(message!="") g_commands[idx].message=message;
   g_commands[idx].updated_at_ms=updated_at_ms;
   return true;
  }

void LoadCommandJournal()
  {
   ArrayResize(g_commands,0);
   const int handle=FileOpen(BRIDGE_COMMAND_JOURNAL,FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE)
     {
      Print("BetterChartsBridge: command journal unreadable at startup; continuing with an empty registry");
      return;
     }
   int events_read=0;
   while(!FileIsEnding(handle))
     {
      string line=FileReadString(handle);
      StringTrimRight(line);
      StringTrimLeft(line);
      if(StringLen(line)<2) continue;
      const string command_id=JsonStringField(line,"command_id");
      const string status=JsonStringField(line,"status");
      const long at_update=JsonIntegerField(line,"at_update",0);
      if(command_id=="" || status=="" || at_update<1) continue;
      ApplyCommandEvent(command_id,JsonStringField(line,"payload_hash"),status,at_update,
                         JsonIntegerField(line,"retcode",-1),JsonIntegerField(line,"last_error",-1),
                         JsonStringField(line,"broker_order_id"),JsonStringField(line,"deal_id"),
                         JsonStringField(line,"position_id"),JsonStringField(line,"filled_volume"),
                         JsonStringField(line,"message"),JsonIntegerField(line,"updated_at_ms",0));
      events_read++;
     }
   FileClose(handle);
   PrintFormat("BetterChartsBridge: command journal restored %d event(s); commands are never re-dispatched after restart",events_read);
  }

// Journals the transition first; returns 1=journalled, 0=journal write failed, -1=unknown command.
// Fields not present in this event keep their previous value so a replayed state
// still carries the strongest broker evidence seen so far.
int RecordCommandUpdate(const string command_id,const string status,const long retcode,const long last_error,const string broker_order_id,const string deal_id,const string position_id,const string filled_volume,const string message)
  {
   const int idx=FindCommand(command_id);
   if(idx<0) return -1;
   g_commands[idx].status=status;
   g_commands[idx].at_update++;
   if(retcode>=0) g_commands[idx].retcode=retcode;
   if(last_error>=0) g_commands[idx].last_error=last_error;
   if(broker_order_id!="") g_commands[idx].broker_order_id=broker_order_id;
   if(deal_id!="") g_commands[idx].deal_id=deal_id;
   if(position_id!="") g_commands[idx].position_id=position_id;
   if(filled_volume!="") g_commands[idx].filled_volume=filled_volume;
   if(message!="") g_commands[idx].message=message;
   g_commands[idx].updated_at_ms=(long)TimeGMT()*1000;
   if(!JournalAppendLine(CommandJournalLine(g_commands[idx]))) return 0;
   return 1;
  }

void SendOrderCommandUpdate(const string command_id)
  {
   const int idx=FindCommand(command_id);
   if(idx<0) return;
   const string payload=StringFormat("{\"command_id\":\"%s\",\"status\":\"%s\",\"retcode\":%s,\"last_error\":%s,\"broker_order_id\":%s,\"deal_id\":%s,\"position_id\":%s,\"filled_volume\":%s,\"message\":%s,\"updated_at_ms\":%I64d,\"at_update\":%I64d}",
                                     JsonEscape(g_commands[idx].command_id),JsonEscape(g_commands[idx].status),
                                     CommandLongJson(g_commands[idx].retcode),CommandLongJson(g_commands[idx].last_error),
                                     CommandTextJson(g_commands[idx].broker_order_id),CommandTextJson(g_commands[idx].deal_id),
                                     CommandTextJson(g_commands[idx].position_id),CommandTextJson(g_commands[idx].filled_volume),
                                     OptionalTextJson(g_commands[idx].message),g_commands[idx].updated_at_ms,g_commands[idx].at_update);
   g_message_id++;
   const string frame=StringFormat("{\"v\":1,\"type\":\"order_command_update\",\"id\":\"ea-order-cmd-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":%s}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,payload);
   SendFrame(frame);
  }

void SendOrderCommandError(const string command_id,const string code,string message)
  {
   if(StringLen(message)>256) message=StringSubstr(message,0,256);
   g_message_id++;
   const string frame=StringFormat("{\"v\":1,\"type\":\"order_command_error\",\"id\":\"ea-order-cmd-error-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"command_id\":%s,\"code\":\"%s\",\"message\":\"%s\"}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,(command_id==""?"null":"\""+JsonEscape(command_id)+"\""),JsonEscape(code),JsonEscape(message));
   SendFrame(frame);
  }

string CommandPayloadHash(const string canonical)
  {
   uint hash=2166136261;
   const int length=StringLen(canonical);
   for(int i=0;i<length;i++)
     {
      hash^=(uint)StringGetCharacter(canonical,i);
      hash*=16777619;
     }
   return StringFormat("%08X",hash);
  }

void RecordTradeCallResult(const string command_id,const string status,const long retcode,const int last_error,const ulong order,const ulong deal,const ulong position,const string message)
  {
   const int journal_state=RecordCommandUpdate(command_id,status,retcode,(long)last_error,
                                                (order==0?"":IntegerToString((long)order)),
                                                (deal==0?"":IntegerToString((long)deal)),
                                                (position==0?"":IntegerToString((long)position)),
                                                "",message);
   if(journal_state==-1) return;
   if(journal_state!=1) SendOrderCommandError(command_id,"JOURNAL_UNAVAILABLE","unable to write command journal");
   SendOrderCommandUpdate(command_id);
  }

string TradeCallStatus(const bool ok,const uint retcode,const ulong order,const ulong deal)
  {
   // A lost connection leaves the broker outcome unknown; never guess either way.
   if(retcode==TRADE_RETCODE_CONNECTION) return "unknown";
   // Broker evidence beats the wrapper boolean: CTrade reports false for some
   // retcodes even though the server placed the order or filled partially.
   if(retcode==TRADE_RETCODE_DONE || order!=0 || deal!=0) return "server_accepted";
   return "rejected";
  }

void ClearWatch()
  {
   g_watch_id="";
   g_watch_kind="";
   g_watch_symbol="";
   g_watch_order=0;
   g_watch_position=0;
   g_watch_volume=0.0;
   g_watch_filled=0.0;
  }

void ArmCommandWatch(const string command_id,const string kind,const string symbol,const ulong order,const ulong position,const double volume)
  {
   g_watch_id=command_id;
   g_watch_kind=kind;
   g_watch_symbol=symbol;
   g_watch_order=order;
   g_watch_position=position;
   g_watch_volume=volume;
   g_watch_filled=0.0;
  }

void ArmCommandInFlight(const string command_id)
  {
   g_inflight=true;
   g_inflight_id=command_id;
   g_inflight_since_ms=GetTickCount64();
  }

void ReleaseCommandInFlight()
  {
   g_inflight=false;
   g_inflight_id="";
  }

// Facts from OnTradeTransaction advance the watched command to filled or
// partially_filled; a late deal also resolves a command left unknown.
void HandleCommandTransaction(const MqlTradeTransaction &trans)
  {
   if(g_watch_id=="") return;
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD && trans.type!=TRADE_TRANSACTION_HISTORY_ADD) return;
   if(trans.deal==0) return;
   int idx=FindCommand(g_watch_id);
   if(idx<0) { ClearWatch(); return; }
   const string current=g_commands[idx].status;
   if(current=="filled" || current=="rejected") { ClearWatch(); return; }
   HistorySelect((datetime)(TimeCurrent()-86400),(datetime)(TimeCurrent()+60));
   ulong deal_order=(ulong)HistoryDealGetInteger(trans.deal,DEAL_ORDER);
   if(deal_order==0) deal_order=trans.order;
   ulong deal_position=(ulong)HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID);
   double deal_volume=HistoryDealGetDouble(trans.deal,DEAL_VOLUME);
   if(deal_volume<=0.0) deal_volume=trans.volume;
   bool match=false;
   if(g_watch_kind=="submit" && g_watch_order!=0 && deal_order==g_watch_order) match=true;
   if(g_watch_position!=0 && deal_position!=0 && deal_position==g_watch_position) match=true;
   if(!match) return;
   if(deal_position!=0) g_watch_position=deal_position;
   g_watch_filled+=deal_volume;
   double step=0.00000001;
   if(g_watch_symbol!="")
     {
      const double symbol_step=SymbolInfoDouble(g_watch_symbol,SYMBOL_VOLUME_STEP);
      if(symbol_step>0.0) step=symbol_step;
     }
   const bool full=(g_watch_volume<=0.0 || g_watch_filled>=g_watch_volume-step*0.5);
   const string new_status=(full?"filled":"partially_filled");
   const int journal_state=RecordCommandUpdate(g_watch_id,new_status,-1,-1,
                                                (deal_order==0?"":IntegerToString((long)deal_order)),
                                                IntegerToString((long)trans.deal),
                                                (deal_position==0?"":IntegerToString((long)deal_position)),
                                                DoubleToString(deal_volume,8),
                                                (full?"fill confirmed by OnTradeTransaction":"partial fill confirmed by OnTradeTransaction"));
   if(journal_state==-1) { ClearWatch(); return; }
   if(journal_state!=1) SendOrderCommandError(g_watch_id,"JOURNAL_UNAVAILABLE","unable to write command journal");
   SendOrderCommandUpdate(g_watch_id);
   if(full)
     {
      ReleaseCommandInFlight();
      ClearWatch();
     }
   else if(g_inflight) g_inflight_since_ms=GetTickCount64();
  }

// A command that dispatched but never received broker confirmation becomes
// unknown. It is released for the queue and never re-dispatched; the retained
// watch still accepts late OnTradeTransaction evidence that resolves it.
void CheckCommandAckTimeout(const ulong now)
  {
   if(!g_inflight) return;
   if(now-g_inflight_since_ms<=BRIDGE_COMMAND_ACK_TIMEOUT_MS) return;
   const string timed_out_id=g_inflight_id;
   ReleaseCommandInFlight();
   const int journal_state=RecordCommandUpdate(timed_out_id,"unknown",-1,-1,"","","","","no broker confirmation arrived in time");
   if(journal_state==-1) return;
   if(journal_state!=1) SendOrderCommandError(timed_out_id,"JOURNAL_UNAVAILABLE","unable to write command journal");
   SendOrderCommandUpdate(timed_out_id);
  }

bool BeginCommandDispatch(const string command_id)
  {
   const int journal_state=RecordCommandUpdate(command_id,"dispatching",-1,-1,"","","","","");
   if(journal_state==-1) { SendOrderCommandError(command_id,"UNKNOWN_COMMAND","command is not registered"); return false; }
   if(journal_state!=1) { SendOrderCommandError(command_id,"JOURNAL_UNAVAILABLE","unable to write command journal"); return false; }
   SendOrderCommandUpdate(command_id);
   return true;
  }

// Human-readable trade-retcode description for rejection evidence. Only the
// build's own TRADE_RETCODE_* identifiers are compared (never raw numbers), so
// the label always matches this terminal; unknown codes fall back to a generic
// label — the numeric retcode is always carried alongside.
string TradeRetcodeText(const uint retcode)
  {
   if(retcode==TRADE_RETCODE_DONE) return "TRADE_RETCODE_DONE";
   if(retcode==TRADE_RETCODE_DONE_PARTIAL) return "TRADE_RETCODE_DONE_PARTIAL";
   if(retcode==TRADE_RETCODE_CONNECTION) return "TRADE_RETCODE_CONNECTION";
   if(retcode==TRADE_RETCODE_REQUOTE) return "TRADE_RETCODE_REQUOTE";
   if(retcode==TRADE_RETCODE_REJECT) return "TRADE_RETCODE_REJECT";
   if(retcode==TRADE_RETCODE_INVALID) return "TRADE_RETCODE_INVALID";
   if(retcode==TRADE_RETCODE_INVALID_VOLUME) return "TRADE_RETCODE_INVALID_VOLUME";
   if(retcode==TRADE_RETCODE_INVALID_PRICE) return "TRADE_RETCODE_INVALID_PRICE";
   if(retcode==TRADE_RETCODE_INVALID_STOPS) return "TRADE_RETCODE_INVALID_STOPS";
   if(retcode==TRADE_RETCODE_INVALID_EXPIRATION) return "TRADE_RETCODE_INVALID_EXPIRATION";
   if(retcode==TRADE_RETCODE_INVALID_FILL) return "TRADE_RETCODE_INVALID_FILL";
   if(retcode==TRADE_RETCODE_INVALID_ORDER) return "TRADE_RETCODE_INVALID_ORDER";
   if(retcode==TRADE_RETCODE_NO_MONEY) return "TRADE_RETCODE_NO_MONEY";
   if(retcode==TRADE_RETCODE_MARKET_CLOSED) return "TRADE_RETCODE_MARKET_CLOSED";
   if(retcode==TRADE_RETCODE_TRADE_DISABLED) return "TRADE_RETCODE_TRADE_DISABLED";
   if(retcode==TRADE_RETCODE_PRICE_CHANGED) return "TRADE_RETCODE_PRICE_CHANGED";
   if(retcode==TRADE_RETCODE_PRICE_OFF) return "TRADE_RETCODE_PRICE_OFF";
   if(retcode==TRADE_RETCODE_ORDER_CHANGED) return "TRADE_RETCODE_ORDER_CHANGED";
   if(retcode==TRADE_RETCODE_TOO_MANY_REQUESTS) return "TRADE_RETCODE_TOO_MANY_REQUESTS";
   if(retcode==TRADE_RETCODE_NO_CHANGES) return "TRADE_RETCODE_NO_CHANGES";
   if(retcode==TRADE_RETCODE_LOCKED) return "TRADE_RETCODE_LOCKED";
   if(retcode==TRADE_RETCODE_FROZEN) return "TRADE_RETCODE_FROZEN";
   if(retcode==TRADE_RETCODE_POSITION_CLOSED) return "TRADE_RETCODE_POSITION_CLOSED";
   if(retcode==TRADE_RETCODE_ONLY_REAL) return "TRADE_RETCODE_ONLY_REAL";
   if(retcode==TRADE_RETCODE_LIMIT_ORDERS) return "TRADE_RETCODE_LIMIT_ORDERS";
   if(retcode==TRADE_RETCODE_LIMIT_VOLUME) return "TRADE_RETCODE_LIMIT_VOLUME";
   return "unknown retcode";
  }

// Full diagnosis for a failed OrderSend, journaled as the command update's
// message: "OrderSend failed: retcode=<n> last_error=<n> [<trade-description>]"
// plus the server comment. Control characters are stripped and the result is
// capped at 256 chars per the wire message contract.
string SendFailureDiagnosis(const bool ok,const MqlTradeResult &result,const int last_error)
  {
   string clean_comment="";
   const int comment_length=StringLen(result.comment);
   for(int i=0;i<comment_length;i++)
     {
      const ushort code=StringGetCharacter(result.comment,i);
      // Rust-side message contract: no control characters (char::is_control).
      if(code>=0x20 && code!=0x7F && (code<0x80 || code>0x9F)) clean_comment=clean_comment+ShortToString(code);
     }
   string note=StringFormat("%s: retcode=%u last_error=%d [%s]",(ok ? "broker rejected the request" : "OrderSend failed"),result.retcode,last_error,TradeRetcodeText(result.retcode));
   if(clean_comment!="") note=note+" - "+clean_comment;
   if(StringLen(note)>256) note=StringSubstr(note,0,256);
   return note;
  }

// Preflight for order_submit_request: fresh quote, symbol grid, geometry and a
// fresh OrderCheck() over the exact request that will be sent. Read-only.
bool BuildSubmitRequest(const BridgeCommandRequest &req,MqlTradeRequest &request,string &failure,string &filling_note)
  {
   failure="preflight failed";
   filling_note="";
   if(StringLen(req.draft_id)>128 || StringLen(req.symbol)>64 || StringLen(req.volume)>32 || StringLen(req.entry)>32 || StringLen(req.stop_loss)>32 || StringLen(req.take_profit)>32 || StringLen(req.order_kind)>16 || StringLen(req.time_in_force)>8 || StringLen(req.limit_price)>32)
     { failure="preflight rejected an oversized field"; return false; }
   if(!EnsureSymbol(req.symbol) || !HasValidSymbolMetadata(req.symbol))
     { failure="symbol is unavailable or has invalid trading metadata"; return false; }
   double volume=0.0,entry=0.0,stop_loss=0.0,take_profit=0.0;
   const bool has_stop=(req.stop_loss!="");
   const bool has_take=(req.take_profit!="");
   double limit_price=0.0;
   const bool has_limit_price=(req.limit_price!="");
   if(!ParsePositiveDecimal(req.volume,volume) || !ParsePositiveDecimal(req.entry,entry) || (has_stop && !ParsePositiveDecimal(req.stop_loss,stop_loss)) || (has_take && !ParsePositiveDecimal(req.take_profit,take_profit)))
     { failure="volume and supplied prices must be positive decimal values"; return false; }
   if(!IsValidTimeInForce(req.time_in_force))
     { failure="time_in_force must be gtc, day, ioc, or fok"; return false; }
   if(req.order_kind=="stop_limit" && !has_limit_price)
     { failure="stop_limit requires limit_price (resting limit price)"; return false; }
   if(has_limit_price && !ParsePositiveDecimal(req.limit_price,limit_price))
     { failure="limit_price must be a positive decimal value"; return false; }
   const double tick_size=SymbolInfoDouble(req.symbol,SYMBOL_TRADE_TICK_SIZE);
   const double volume_min=SymbolInfoDouble(req.symbol,SYMBOL_VOLUME_MIN);
   const double volume_max=SymbolInfoDouble(req.symbol,SYMBOL_VOLUME_MAX);
   const double volume_step=SymbolInfoDouble(req.symbol,SYMBOL_VOLUME_STEP);
   if(!IsGridValue(volume,volume_min,volume_max,volume_step))
     { failure="volume must be on the symbol min/max/step grid"; return false; }
   // Tick-alignment of limit_price applies to stop_limit only (ignored for
   // the other kinds, matching Rust); the positive-decimal check above stays.
   if(!IsTickPrice(entry,tick_size) || (has_stop && !IsTickPrice(stop_loss,tick_size)) || (has_take && !IsTickPrice(take_profit,tick_size)) || (req.order_kind=="stop_limit" && !IsTickPrice(limit_price,tick_size)))
     { failure="prices must align with the symbol tick size"; return false; }
   MqlTick tick;
   if(!SymbolInfoTick(req.symbol,tick) || tick.bid<=0.0 || tick.ask<=0.0)
     { failure="live bid/ask quote is unavailable"; return false; }
   const bool is_buy=(req.side=="buy");
   const double check_price=(req.order_kind=="market" ? (is_buy ? tick.ask : tick.bid) : NormalizeDouble(entry,(int)SymbolInfoInteger(req.symbol,SYMBOL_DIGITS)));
   if(req.order_kind=="limit" && (is_buy ? entry>=tick.ask : entry<=tick.bid))
     { failure="limit entry must be below ask for buy or above bid for sell"; return false; }
   if(req.order_kind=="stop" && (is_buy ? entry<=tick.ask : entry>=tick.bid))
     { failure="stop entry must be above ask for buy or below bid for sell"; return false; }
   if(req.order_kind=="stop_limit" && (is_buy ? entry<=tick.ask : entry>=tick.bid))
     { failure="stop_limit trigger must be above ask for buy or below bid for sell"; return false; }
   const double geometry_entry=(req.order_kind=="stop_limit" ? limit_price : check_price);
   if(!ValidRiskGeometry(req.side,geometry_entry,has_stop,stop_loss,has_take,take_profit))
     { failure="stop loss or take profit has invalid side geometry"; return false; }
   // Apply the same distance rule as the read-only check before dispatch. A
   // violation becomes PREFLIGHT_FAILED and never reaches OrderSend.
   const int digits=(int)SymbolInfoInteger(req.symbol,SYMBOL_DIGITS);
   if(!ValidOrderStopDistances(req.symbol,req.side,req.order_kind,geometry_entry,has_stop,stop_loss,has_take,take_profit,tick,failure)) return false;
   request.symbol=req.symbol;
   request.volume=volume;
   request.price=check_price;
   // Prices were tick-aligned above; normalize to the symbol digits so the
   // request never carries stray float residue on the wire. An absent stop
   // loss sends sl=0.0 (MQL5: no stop loss attached).
   request.sl=(has_stop ? NormalizeDouble(stop_loss,digits) : 0.0);
   request.tp=(has_take ? NormalizeDouble(take_profit,digits) : 0.0);
   request.type_time=ORDER_TIME_GTC;
   if(req.order_kind=="market")
     {
      request.action=TRADE_ACTION_DEAL;
      request.type=(is_buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
      const long execution=(long)SymbolInfoInteger(req.symbol,SYMBOL_TRADE_EXEMODE);
      // Market execution fills at market: send price 0.0 so no stale fixed price
      // reaches the server — a fixed price on TRADE_ACTION_DEAL can make some
      // servers reject the attached stops (TRADE_RETCODE_INVALID_STOPS). This is
      // the suspected root cause of the observed 10016 rejection on a market
      // buy with stops far beyond stops_level. Request/execution modes keep the
      // normalized entry price assigned above.
      if(execution==SYMBOL_TRADE_EXECUTION_MARKET) request.price=0.0;
      if(!ResolveMarketFilling(req.symbol,req.time_in_force,execution,request.type_filling,filling_note))
        { failure="symbol has no allowed market filling mode"; return false; }
     }
   else
     {
      request.action=TRADE_ACTION_PENDING;
      if(req.order_kind=="limit") request.type=(is_buy ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT);
      else if(req.order_kind=="stop") request.type=(is_buy ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP);
      else
        {
         request.type=(is_buy ? ORDER_TYPE_BUY_STOP_LIMIT : ORDER_TYPE_SELL_STOP_LIMIT);
         // MQL5 mapping (verified against CTrade::OrderOpen in this install's
         // standard library: its `limit_price` argument lands in
         // m_request.stoplimit): request.price carries the STOP trigger,
         // request.stoplimit the resting LIMIT price.
         request.price=NormalizeDouble(entry,digits);
         request.stoplimit=NormalizeDouble(limit_price,digits);
        }
      request.type_time=PendingExpiration(req.time_in_force);
      if(!ResolvePendingFilling(req.symbol,req.time_in_force,request.type_filling,filling_note))
        { failure="symbol has no allowed pending filling mode"; return false; }
     }
   MqlTradeCheckResult checked={};
   ResetLastError();
   const bool passed=OrderCheck(request,checked);
   if(!passed)
     {
      failure=(checked.comment!="" ? checked.comment : "OrderCheck rejected the request");
      return false;
     }
   failure="";
   return true;
  }

void DispatchSubmit(const BridgeCommandRequest &req)
  {
   MqlTradeRequest request={};
   string failure="";
   string filling_note="";
   if(!BuildSubmitRequest(req,request,failure,filling_note))
     {
      SendOrderCommandError(req.command_id,"PREFLIGHT_FAILED",failure);
      return;
     }
   if(!BeginCommandDispatch(req.command_id)) return;
   ArmCommandWatch(req.command_id,"submit",req.symbol,0,0,request.volume);
   ArmCommandInFlight(req.command_id);
   MqlTradeResult result={};
   ResetLastError();
   const bool ok=g_trade.OrderSend(request,result);
   const int last_error=GetLastError();
   if(result.order!=0) g_watch_order=result.order;
   const string status=TradeCallStatus(ok,result.retcode,result.order,result.deal);
   long stored_retcode=(long)result.retcode;
   if(stored_retcode==0) stored_retcode=-1;
   string note="dispatch finished";
   if(status=="unknown") note="broker outcome is unknown; the command is not retried";
   else if(status=="rejected") note=SendFailureDiagnosis(ok,result,last_error);
   else if(request.action==TRADE_ACTION_PENDING) note="pending order placed";
   else note="order submitted; awaiting fill confirmation";
   // A resolved filling fallback is observable evidence for the journaled update.
   if(filling_note!="") note=note+"; "+filling_note;
   RecordTradeCallResult(req.command_id,status,stored_retcode,last_error,result.order,result.deal,0,note);
   if(status!="server_accepted")
     {
      ReleaseCommandInFlight();
      if(status=="rejected") ClearWatch();
      return;
     }
   if(request.action==TRADE_ACTION_PENDING)
     {
      // Limit and stop submissions settle the queue at server_accepted.
      ReleaseCommandInFlight();
      ClearWatch();
     }
  }

void DispatchModify(const BridgeCommandRequest &req)
  {
   const long ticket=StringToInteger(req.target_id);
   const bool has_stop=(req.stop_loss!="");
   const bool has_take=(req.take_profit!="");
   const bool has_price=(req.price!="");
   if(req.target_kind=="position")
     {
      if(!PositionSelectByTicket((ulong)ticket))
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target position does not exist"); return; }
      double sl=PositionGetDouble(POSITION_SL);
      double tp=PositionGetDouble(POSITION_TP);
      if(has_stop) sl=StringToDouble(req.stop_loss);
      if(has_take) tp=StringToDouble(req.take_profit);
      if(!BeginCommandDispatch(req.command_id)) return;
      ResetLastError();
      const bool ok=g_trade.PositionModify((ulong)ticket,sl,tp);
      const int modify_error=GetLastError();
      const string modify_status=(ok?"server_accepted":"rejected");
      RecordTradeCallResult(req.command_id,modify_status,-1,modify_error,0,0,(ulong)ticket,
                            (ok ? "position modification accepted" : "PositionModify failed"));
      return;
     }
   if(!OrderSelect((ulong)ticket))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target order does not exist"); return; }
   if(!IsPendingOrderType(OrderGetInteger(ORDER_TYPE)))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target is not a pending order"); return; }
   double pending_sl=OrderGetDouble(ORDER_SL);
   double pending_tp=OrderGetDouble(ORDER_TP);
   double pending_price=OrderGetDouble(ORDER_PRICE_OPEN);
   if(has_stop) pending_sl=StringToDouble(req.stop_loss);
   if(has_take) pending_tp=StringToDouble(req.take_profit);
   if(has_price) pending_price=StringToDouble(req.price);
   if(!BeginCommandDispatch(req.command_id)) return;
   ResetLastError();
   const bool ok=g_trade.OrderModify((ulong)ticket,pending_price,pending_sl,pending_tp,ORDER_TIME_GTC,0);
   const int modify_error=GetLastError();
   const string modify_status=(ok?"server_accepted":"rejected");
   RecordTradeCallResult(req.command_id,modify_status,-1,modify_error,(ok?(ulong)ticket:(ulong)0),0,0,
                         (ok ? "pending order modification accepted" : "OrderModify failed"));
  }

void DispatchClose(const BridgeCommandRequest &req)
  {
   const long ticket=StringToInteger(req.position_id);
   if(!PositionSelectByTicket((ulong)ticket))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target position does not exist"); return; }
   const double position_volume=PositionGetDouble(POSITION_VOLUME);
   const string position_symbol=PositionGetString(POSITION_SYMBOL);
   if(!BeginCommandDispatch(req.command_id)) return;
   ArmCommandWatch(req.command_id,"close",position_symbol,0,(ulong)ticket,position_volume);
   ArmCommandInFlight(req.command_id);
   ResetLastError();
   const bool ok=g_trade.PositionClose((ulong)ticket);
   const int close_error=GetLastError();
   const string close_status=(ok?"server_accepted":"rejected");
   RecordTradeCallResult(req.command_id,close_status,-1,close_error,0,0,(ulong)ticket,
                         (ok ? "close order submitted; awaiting fill confirmation" : "PositionClose failed"));
   if(!ok)
     {
      ReleaseCommandInFlight();
      ClearWatch();
     }
  }

void DispatchCancel(const BridgeCommandRequest &req)
  {
   const long ticket=StringToInteger(req.order_id);
   if(!OrderSelect((ulong)ticket))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target order does not exist"); return; }
   if(!IsPendingOrderType(OrderGetInteger(ORDER_TYPE)))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target is not a pending order"); return; }
   if(!BeginCommandDispatch(req.command_id)) return;
   ResetLastError();
   const bool ok=g_trade.OrderDelete((ulong)ticket);
   const int cancel_error=GetLastError();
   const string cancel_status=(ok?"server_accepted":"rejected");
   RecordTradeCallResult(req.command_id,cancel_status,-1,cancel_error,(ok?(ulong)ticket:(ulong)0),0,0,
                         (ok ? "pending order cancelled" : "OrderDelete failed"));
  }

void ExecuteCommand(const BridgeCommandRequest &req)
  {
   // Session identity and trading permissions are re-checked at dispatch time.
   if(g_state!=BRIDGE_READY)
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","bridge session is not ready"); return; }
   if(req.account_login!=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) || req.broker_server!=AccountInfoString(ACCOUNT_SERVER))
     { SendOrderCommandError(req.command_id,"INVALID_REQUEST","request account does not match the connected MT5 account"); return; }
   if(!TradingEnabled())
     { SendOrderCommandError(req.command_id,"BROKER_UNAVAILABLE","terminal, EA, or account does not permit trading"); return; }
   // Market-session gate re-checked at dispatch: a command accepted while the
   // session was open cannot execute after it closes. Rejection is terminal
   // for this command (no retry), like the other preflight rejections.
   if(req.kind=="order_submit_request" && !MarketSessionOpen(req.symbol))
     { SendOrderCommandError(req.command_id,"SESSION_CLOSED","market session is closed for this symbol"); return; }
   if(req.kind=="order_submit_request") DispatchSubmit(req);
   else if(req.kind=="order_modify_request") DispatchModify(req);
   else if(req.kind=="order_close_request") DispatchClose(req);
   else if(req.kind=="order_cancel_request") DispatchCancel(req);
   else SendOrderCommandError(req.command_id,"UNKNOWN_COMMAND","unsupported order command type");
  }

// Exactly one command is in flight: queued commands start only after the active
// one reaches a terminal-ish state (filled, rejected, unknown, or server_accepted
// for limit/stop submits and synchronous modify/cancel results).
void ProcessCommandQueue()
  {
   while(!g_inflight && g_queue_count>0)
     {
      BridgeCommandRequest req=g_queue[0];
      for(int i=1;i<g_queue_count;i++) g_queue[i-1]=g_queue[i];
      g_queue_count--;
      ExecuteCommand(req);
     }
  }

bool ValidateCommandFields(const BridgeCommandRequest &req)
  {
   double probe=0.0;
   if(req.kind=="order_submit_request")
     {
      if(req.draft_id=="" || StringLen(req.draft_id)>128 || req.symbol=="" || StringLen(req.symbol)>64 ||
         (req.side!="buy" && req.side!="sell") ||
         (req.order_kind!="market" && req.order_kind!="limit" && req.order_kind!="stop" && req.order_kind!="stop_limit") ||
         StringLen(req.order_kind)>16 || StringLen(req.time_in_force)>8 || StringLen(req.limit_price)>32 ||
         req.volume=="" || req.entry=="" ||
         StringLen(req.volume)>32 || StringLen(req.entry)>32 || StringLen(req.stop_loss)>32 || StringLen(req.take_profit)>32 ||
         (req.order_kind=="stop_limit" && req.limit_price==""))
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","order submit payload is missing a required field"); return false; }
      if(!IsValidTimeInForce(req.time_in_force))
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","time_in_force must be gtc, day, ioc, or fok"); return false; }
      if(!ParsePositiveDecimal(req.volume,probe) || !ParsePositiveDecimal(req.entry,probe) ||
         (req.stop_loss!="" && !ParsePositiveDecimal(req.stop_loss,probe)) || (req.take_profit!="" && !ParsePositiveDecimal(req.take_profit,probe)) ||
         (req.limit_price!="" && !ParsePositiveDecimal(req.limit_price,probe)))
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","volume and prices must be positive decimals"); return false; }
      return true;
     }
   if(req.kind=="order_modify_request")
     {
      if((req.target_kind!="position" && req.target_kind!="pending_order") || req.target_id=="" || StringLen(req.target_id)>32 || StringToInteger(req.target_id)<=0)
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","target_kind and a positive target_id are required"); return false; }
      if(req.target_kind!="pending_order" && req.price!="")
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","price is only valid for pending_order targets"); return false; }
      if(req.stop_loss=="" && req.take_profit=="" && req.price=="")
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","modify request has no fields to change"); return false; }
      // SL/TP accept the "0" remove sentinel (see ParseLevelDecimal);
      // the re-price stays strictly positive.
      if((req.stop_loss!="" && !ParseLevelDecimal(req.stop_loss,probe)) ||
         (req.take_profit!="" && !ParseLevelDecimal(req.take_profit,probe)) ||
         (req.price!="" && !ParsePositiveDecimal(req.price,probe)))
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","modify values must be positive decimals or zero"); return false; }
      return true;
     }
   if(req.kind=="order_close_request")
     {
      if(req.position_id=="" || StringLen(req.position_id)>32 || StringToInteger(req.position_id)<=0)
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","position_id is required"); return false; }
      if(req.volume!="")
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","partial close is not supported; volume must be null"); return false; }
      return true;
     }
   if(req.kind=="order_cancel_request")
     {
      if(req.order_id=="" || StringLen(req.order_id)>32 || StringToInteger(req.order_id)<=0)
        { SendOrderCommandError(req.command_id,"INVALID_REQUEST","order_id is required"); return false; }
      return true;
     }
   SendOrderCommandError(req.command_id,"UNKNOWN_COMMAND","unsupported order command type");
   return false;
  }

void HandleOrderCommand(const string kind,const string json)
  {
   const string command_id=JsonStringField(json,"command_id");
   if(command_id=="") { SendOrderCommandError("","INVALID_REQUEST","command_id is required"); return; }
   if(StringLen(command_id)>128) { SendOrderCommandError(command_id,"INVALID_REQUEST","command_id exceeds 128 bytes"); return; }
   if(g_state!=BRIDGE_READY) { SendOrderCommandError(command_id,"INVALID_REQUEST","bridge session is not ready"); return; }

   BridgeCommandRequest req={};
   req.kind=kind;
   req.command_id=command_id;
   req.draft_id=JsonStringField(json,"draft_id");
   req.account_login=JsonStringField(json,"account_login");
   req.broker_server=JsonStringField(json,"broker_server");
   req.symbol=JsonStringField(json,"symbol");
   req.side=JsonStringField(json,"side");
   req.order_kind=JsonStringField(json,"order_kind");
   req.volume=JsonStringField(json,"volume");
   req.entry=JsonStringField(json,"entry");
   req.stop_loss=JsonStringField(json,"stop_loss");
   req.take_profit=JsonStringField(json,"take_profit");
   req.time_in_force=JsonStringField(json,"time_in_force");
   req.limit_price=JsonStringField(json,"limit_price");
   req.target_kind=JsonStringField(json,"target_kind");
   req.target_id=JsonStringField(json,"target_id");
   req.price=JsonStringField(json,"price");
   req.position_id=JsonStringField(json,"position_id");
   req.order_id=JsonStringField(json,"order_id");

   if(req.account_login=="" || StringLen(req.account_login)>128 || req.broker_server=="" || StringLen(req.broker_server)>128)
     { SendOrderCommandError(command_id,"INVALID_REQUEST","account_login and broker_server are required"); return; }
   if(req.account_login!=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) || req.broker_server!=AccountInfoString(ACCOUNT_SERVER))
     { SendOrderCommandError(command_id,"INVALID_REQUEST","request account does not match the connected MT5 account"); return; }
   if(!TradingEnabled())
     { SendOrderCommandError(command_id,"BROKER_UNAVAILABLE","terminal, EA, or account does not permit trading"); return; }
   if(!ValidateCommandFields(req)) return;

   // Appended only when present, so a payload without the extension fields
   // keeps the exact pre-extension hash (idempotency stays byte-stable).
   string canonical=req.kind+"|"+req.command_id+"|"+req.draft_id+"|"+req.account_login+"|"+req.broker_server+"|"+req.symbol+"|"+req.side+"|"+req.order_kind+"|"+req.volume+"|"+req.entry+"|"+req.stop_loss+"|"+req.take_profit+"|"+req.target_kind+"|"+req.target_id+"|"+req.price+"|"+req.position_id+"|"+req.order_id;
   if(req.time_in_force!="") canonical+="|"+req.time_in_force;
   if(req.limit_price!="") canonical+="|"+req.limit_price;
   req.payload_hash=CommandPayloadHash(canonical);
   const int existing=FindCommand(command_id);
   if(existing>=0)
     {
      if(g_commands[existing].payload_hash==req.payload_hash) SendOrderCommandUpdate(command_id);
      else SendOrderCommandError(command_id,"DUPLICATE_CONFLICT","command_id was already used with a different payload");
      return;
     }
   if(g_queue_count>=BRIDGE_COMMAND_QUEUE_MAX)
     { SendOrderCommandError(command_id,"INVALID_REQUEST","command queue already holds 32 pending commands"); return; }

   // Durable acceptance is written before anything can reach the broker.
   if(!ApplyCommandEvent(command_id,req.payload_hash,"accepted",1,-1,-1,"","","","","",(long)TimeGMT()*1000))
     { SendOrderCommandError(command_id,"JOURNAL_UNAVAILABLE","unable to register command"); return; }
   const int accepted_idx=FindCommand(command_id);
   if(accepted_idx<0 || !JournalAppendLine(CommandJournalLine(g_commands[accepted_idx])))
     {
      if(accepted_idx>=0) RemoveCommandAt(accepted_idx);
      SendOrderCommandError(command_id,"JOURNAL_UNAVAILABLE","unable to write command journal");
      return;
     }
   SendOrderCommandUpdate(command_id);
   g_queue[g_queue_count]=req;
   g_queue_count++;
  }

void HandleFrame(const string json)
  {
   const string type=ControlType(json);
   if(type=="hello_ack")
     {
      const string session_id=JsonStringField(json,"session_id");
      if(session_id=="")
        {
         DisconnectAndRetry("hello_ack has no session_id");
         return;
        }
      const long frame_bytes=JsonIntegerField(json,"max_frame_bytes",BRIDGE_MAX_FRAME);
      const long page_ticks=JsonIntegerField(json,"max_ticks_per_page",5000);
      if(frame_bytes<1024 || frame_bytes>(long)InpBridgeMaxFrameMiB*1048576 ||
         page_ticks<1 || page_ticks>(long)InpBridgeMaxTicksPerPage)
        {
         DisconnectAndRetry("invalid negotiated transfer limits");
         return;
        }
      g_max_frame_bytes=(uint)frame_bytes;
      g_max_ticks_per_page=(uint)page_ticks;
      g_price_counts_enabled=PriceCountsRequested(json,"tick_price_counts");
      g_session_id=session_id;
      g_state=BRIDGE_READY;
      g_backoff_index=0;
      Print("BetterChartsBridge handshake acknowledged");
      if(!PollAccountSnapshot()) return;
      if(!PollPortfolioSnapshot()) return;
      const ulong now=GetTickCount64();
      g_last_account_poll_ms=now;
      g_last_portfolio_poll_ms=now;
     }
   else if(type=="heartbeat_ack") g_last_rx_ms=GetTickCount64();
   else if(type=="history_request")
     {
      const string request_id=JsonStringField(json,"id");
      const string symbol=JsonStringField(json,"symbol");
      const string timeframe=JsonStringField(json,"timeframe");
      const long bars=JsonIntegerField(json,"bars",0);
      const long before_ms=JsonIntegerField(json,"before_ms",-1);
      if(before_ms>0)
        {
         // Lazy loading: this reads older candles only, so the active feed the
         // window established stays exactly as it was.
         ENUM_TIMEFRAMES page_timeframe=PERIOD_CURRENT;
         ParseTimeframe(timeframe,page_timeframe);
         SendHistoryPage(request_id,symbol,timeframe,page_timeframe,bars,before_ms);
        }
      else
        {
         ENUM_TIMEFRAMES requested_timeframe;
         CancelTickHistory();
         g_history_ready=false;
         g_have_last_bar=false;
         g_have_last_quote=false;
         g_active_symbol="";
         if(!ParseTimeframe(timeframe,requested_timeframe)) SendProtocolError("INVALID_MESSAGE","unsupported timeframe");
         else SendHistorySnapshot(request_id,symbol,timeframe,requested_timeframe,bars);
        }
     }
   else if(type=="tick_history_request")
     {
      const string request_id=JsonStringField(json,"id");
      const string symbol=JsonStringField(json,"symbol");
      const long from_ms=JsonIntegerField(json,"from_ms",-1);
      const long to_ms=JsonIntegerField(json,"to_ms",-1);
      const long max_ticks=JsonIntegerField(json,"max_ticks",0);
      QueueTickHistory(request_id,symbol,from_ms,to_ms,max_ticks,PriceCountsRequested(json,"price_counts"));
     }
   else if(type=="symbol_search_request")
     {
      const string request_id=JsonStringField(json,"id");
      const string query=JsonStringField(json,"query");
      const long limit=JsonIntegerField(json,"limit",0);
      SendSymbolSearchResult(request_id,query,limit);
     }
   else if(type=="symbol_info_request")
     {
      const string request_id=JsonStringField(json,"id");
      const string symbol=JsonStringField(json,"symbol");
      SendSymbolInfoResult(request_id,symbol);
     }
   else if(type=="risk_quote_request")
     {
      const string draft_id=JsonStringField(json,"draft_id");
      const string symbol=JsonStringField(json,"symbol");
      const string side=JsonStringField(json,"side");
      const string entry=JsonStringField(json,"entry");
      const string stop_loss=JsonStringField(json,"stop_loss");
      const string take_profit=JsonStringField(json,"take_profit");
      SendRiskQuote(draft_id,symbol,side,entry,stop_loss,take_profit);
     }
   else if(type=="order_check_request")
     {
      const string draft_id=JsonStringField(json,"draft_id");
      const string account_login=JsonStringField(json,"account_login");
      const string broker_server=JsonStringField(json,"broker_server");
      const string symbol=JsonStringField(json,"symbol");
      const string side=JsonStringField(json,"side");
      const string order_kind=JsonStringField(json,"order_kind");
      const string volume=JsonStringField(json,"volume");
      const string entry=JsonStringField(json,"entry");
      const string stop_loss=JsonStringField(json,"stop_loss");
      const string take_profit=JsonStringField(json,"take_profit");
      const string time_in_force=JsonStringField(json,"time_in_force");
      const string limit_price=JsonStringField(json,"limit_price");
      SendOrderCheck(draft_id,account_login,broker_server,symbol,side,order_kind,volume,entry,stop_loss,take_profit,time_in_force,limit_price);
     }
   else if(type=="reconcile_request")
     {
      const string request_id=JsonStringField(json,"request_id");
      const string account_login=JsonStringField(json,"account_login");
      const string broker_server=JsonStringField(json,"broker_server");
      const long history_from_ms=JsonIntegerField(json,"history_from_ms",-1);
      const long max_orders=JsonIntegerField(json,"max_history_orders",0);
      const long max_deals=JsonIntegerField(json,"max_history_deals",0);
      SendReconcileSnapshot(request_id,account_login,broker_server,history_from_ms,max_orders,max_deals);
     }
   else if(type=="order_submit_request" || type=="order_modify_request" || type=="order_close_request" || type=="order_cancel_request")
     HandleOrderCommand(type,json);
   else if(type=="error")
     {
      Print("BetterChartsBridge received protocol error");
      DisconnectAndRetry("peer protocol error");
     }
  }

void ReadAvailable()
  {
   uchar chunk[];
   ArrayResize(chunk,BRIDGE_READ_CHUNK);
   for(int pass=0;pass<8;pass++)
     {
      const uint available=SocketIsReadable(g_socket);
      if(available==0) break;
      uint read_length=available;
      if(read_length>BRIDGE_READ_CHUNK) read_length=BRIDGE_READ_CHUNK;
      const int n=SocketRead(g_socket,chunk,read_length,50);
      if(n==0) break;
      if(n<0) { DisconnectAndRetry("socket read failed"); return; }
      if(!AppendReceived(chunk,n)) { DisconnectAndRetry("receive buffer limit exceeded"); return; }
      g_last_rx_ms=GetTickCount64();
     }
   while(g_state!=BRIDGE_DISCONNECTED)
     {
      string json;
      if(!TakeFrame(json))
        {
         if(g_rx_size>=4 && FrameLength()==0) DisconnectAndRetry("zero-length frame");
         else if(g_rx_size>=4 && FrameLength()>g_max_frame_bytes) DisconnectAndRetry("frame length exceeds limit");
         break;
        }
      HandleFrame(json);
     }
  }

void TryConnect()
  {
   const ulong now=GetTickCount64();
   if(now<g_next_connect_ms) return;
   // The reader version goes into hello; settle the probe first, without blocking.
   if(!RunReaderProbe()) return;
   g_state=BRIDGE_CONNECTING;
   ResetLastError();
   g_socket=SocketCreate(SOCKET_DEFAULT);
   if(g_socket==INVALID_HANDLE)
     {
      DisconnectAndRetry(StringFormat("socket create failed (error=%d)",GetLastError()));
      return;
     }
   ResetLastError();
   if(!SocketConnect(g_socket,InpBridgeHost,(uint)InpBridgePort,BRIDGE_CONNECT_TIMEOUT))
     {
      DisconnectAndRetry(StringFormat("connect failed (error=%d)",GetLastError()));
      return;
     }
   g_rx_size=0;
   g_max_frame_bytes=BRIDGE_MAX_FRAME;
   g_max_ticks_per_page=5000;
   g_session_id="";
   g_history_ready=false;
   g_have_last_bar=false;
   g_have_last_quote=false;
   g_last_bar_poll_ms=0;
   g_last_account_poll_ms=0;
   g_last_portfolio_poll_ms=0;
   g_identity_login="";
   g_identity_server="";
   g_last_account_payload="";
   g_have_account_snapshot=false;
   g_last_portfolio_payload="";
   g_have_portfolio_snapshot=false;
   g_connected_ms=now;
   g_last_rx_ms=now;
   g_last_heartbeat_ms=now;
   g_warned_oversize=false;
   const bool hello_sent=SendHello();
   // Probe again on the next connect: the reader may be updated meanwhile.
   g_probe_done=false;
   if(!hello_sent) { DisconnectAndRetry("hello send failed"); return; }
   g_state=BRIDGE_HELLO_SENT;
   Print("BetterChartsBridge connected; awaiting handshake");
  }

void OnTimer()
  {
   if(g_state==BRIDGE_DISCONNECTED) { TryConnect(); return; }
   if(!SocketIsConnected(g_socket)) { DisconnectAndRetry("socket is no longer connected"); return; }
   ReadAvailable();
   if(g_state==BRIDGE_DISCONNECTED) return;
   PollMarketData();
   const ulong now=GetTickCount64();
   if(g_state==BRIDGE_READY)
     {
      CheckCommandAckTimeout(now);
      ProcessCommandQueue();
     }
   if(g_state==BRIDGE_HELLO_SENT && now-g_connected_ms>BRIDGE_HANDSHAKE_TIMEOUT_MS) { DisconnectAndRetry("handshake timeout"); return; }
   if(now-g_last_rx_ms>BRIDGE_IDLE_TIMEOUT_MS) { DisconnectAndRetry("heartbeat timeout"); return; }
   if(g_state==BRIDGE_READY && now-g_last_heartbeat_ms>=BRIDGE_HEARTBEAT_MS)
     {
      g_message_id++;
      g_heartbeat_sequence++;
      const bool terminal_connected=(TerminalInfoInteger(TERMINAL_CONNECTED)!=0);
      const string account_login=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
      const bool account_connected=(terminal_connected && account_login!="0" && account_login!="");
      const string broker_server=JsonEscape(AccountInfoString(ACCOUNT_SERVER));
      string heartbeat=StringFormat("{\"v\":1,\"type\":\"heartbeat\",\"id\":\"ea-%I64u\",\"session_id\":\"%s\",\"sent_at_ms\":%I64u,\"payload\":{\"sequence\":%I64u,\"terminal_connected\":%s,\"account_connected\":%s,\"broker_server\":\"%s\",\"market_session\":%s}}",g_message_id,JsonEscape(g_session_id),(ulong)TimeGMT()*1000,g_heartbeat_sequence,(terminal_connected?"true":"false"),(account_connected?"true":"false"),broker_server,MarketSessionJson());
      if(!SendFrame(heartbeat)) { DisconnectAndRetry("heartbeat send failed"); return; }
      g_last_heartbeat_ms=now;
     }
   if(g_state==BRIDGE_READY)
     {
      // Account and portfolio use their own clocks and run after a due
      // heartbeat, so snapshot work can neither gate nor delay liveness.
      // Stable-payload deduplication avoids frames when state is unchanged.
      if(now-g_last_account_poll_ms>=BRIDGE_ACCOUNT_POLL_MS)
        {
         if(!PollAccountSnapshot()) return;
         g_last_account_poll_ms=now;
        }
      if(now-g_last_portfolio_poll_ms>=BRIDGE_PORTFOLIO_POLL_MS)
        {
         if(!PollPortfolioSnapshot()) return;
         g_last_portfolio_poll_ms=now;
        }
     }
   PollTickHistory();
  }

int OnInit()
  {
   if(InpBridgeMaxFrameMiB<1 || InpBridgeMaxFrameMiB>2047 ||
      InpBridgeMaxTicksPerPage<1 || InpBridgeMaxTicksPerPage>65535)
      return INIT_PARAMETERS_INCORRECT;
   PrintFormat("BetterChartsBridge control client: host=%s port=%u trading_enabled=%s",InpBridgeHost,InpBridgePort,(TradingEnabled() ? "yes" : "no"));
   g_next_connect_ms=0;
   LoadCommandJournal();
   EventSetMillisecondTimer(BRIDGE_TIMER_MS);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ReleaseReaderProbe();
   CloseConnection();
   PrintFormat("BetterChartsBridge stopped (reason=%d)",reason);
  }

void OnTick()
  {
   // The timer remains the fallback for symbols other than the EA chart and
   // for quiet markets. For the chart symbol, publish the newest quote/bar as
   // soon as MT5 raises NewTick instead of waiting for the next timer slot.
   if(g_state==BRIDGE_READY && g_active_symbol==_Symbol)
     {
      PollMarketData();
     }
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result)
  {
   // Broker changes bypass the periodic snapshot cadence. Heartbeat is only a
   // liveness signal and never gates portfolio/account visibility in the UI.
   g_trade_sequence++;
   HandleCommandTransaction(trans);
   if(g_state==BRIDGE_READY)
     {
      if(!PollAccountSnapshot()) return;
      if(!PollPortfolioSnapshot()) return;
      const ulong now=GetTickCount64();
      g_last_account_poll_ms=now;
      g_last_portfolio_poll_ms=now;
     }
  }
