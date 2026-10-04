// Historical tick synchronization runs in an indicator: CopyTicks returns
// immediately here, whereas an EA can block for 45 seconds and miss heartbeats.
#property strict
#property indicator_chart_window
#property indicator_plots 0
#property indicator_buffers 0

input long InpFromMs = 1;
input uint InpCount = 5001;
input string InpResultFile = "";

int OnInit()
  {
   if(InpFromMs<0 || InpCount<2 || InpCount>65536 ||
      StringFind(InpResultFile,"TradeCanvasTicks\\")!=0 || StringFind(InpResultFile,"..")>=0)
      return INIT_PARAMETERS_INCORRECT;
   // Dependent iCustom indicators do not receive OnTimer. One bounded
   // attempt runs during initialization; the EA schedules fresh attempts.
   ReadTickPage();
   return INIT_SUCCEEDED;
  }

void ReadTickPage()
  {
   MqlTick ticks[];
   ResetLastError();
   const int copied=CopyTicks(_Symbol,ticks,COPY_TICKS_ALL,(ulong)MathMax(1,InpFromMs),InpCount);
   int error=GetLastError();
   // A synchronizing fragment is an error result, never a complete page.
   if(copied<0 && error==0) error=4403;
   const int count=(error==0 ? copied : 0);
   const string staging=InpResultFile+".tmp";
   const int file=FileOpen(staging,FILE_WRITE|FILE_BIN);
   if(file==INVALID_HANDLE) return;
   FileWriteInteger(file,0x54435031,INT_VALUE);
   FileWriteInteger(file,error,INT_VALUE);
   FileWriteInteger(file,count,INT_VALUE);
   const uint written=(count>0 ? FileWriteArray(file,ticks,0,count) : 0);
   FileClose(file);
   if(written!=(uint)count) { FileDelete(staging); return; }
   // The EA sees only a closed, complete page, never a partially written file.
   if(!FileMove(staging,0,InpResultFile,FILE_REWRITE)) return;
  }

int OnCalculate(const int rates_total,const int prev_calculated,const int begin,const double &price[])
  {
   return rates_total;
  }

void OnDeinit(const int reason)
  {
   FileDelete(InpResultFile+".tmp");
   FileDelete(InpResultFile);
  }
