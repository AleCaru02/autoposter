import { AdminCustomerService } from './admin-customer-service.js';
import { LocalSupabaseClient } from './db.js';

export class MasterAdminService{
  constructor(private readonly db=new LocalSupabaseClient(),private readonly base=new AdminCustomerService(db)){}

  async snapshot(token:string){
    const snapshot=await this.base.snapshot(token);
    if(this.db.config.backend!=='neon')return snapshot;
    const users=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/user?select=id,email,name,emailVerified,createdAt,updatedAt,role,banned,banReason,banExpires&order=createdAt.desc',{headers:{'accept-profile':'neon_auth'}});
    return{...snapshot,users};
  }
}
